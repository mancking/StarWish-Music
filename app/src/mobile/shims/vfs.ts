/**
 * 浏览器端虚拟文件系统（内存树 + IndexedDB 持久化）。
 * 目的：让 electron/core 里 paths/settings/db/log/bili 这些同步 fs 调用原样可用。
 */
import { Buffer } from './util'

type Entry = { dir: boolean; data: Uint8Array }

const tree = new Map<string, Entry>()
const DB_NAME = 'starwish-fs'
const STORE = 'tree'

export function normalize(p: string): string {
  const s = String(p ?? '').replace(/\\/g, '/')
  const out: string[] = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return '/' + out.join('/')
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf('/')
  return i <= 0 ? '/' : n.slice(0, i)
}

function toBytes(data: unknown, enc?: string): Uint8Array {
  if (typeof data === 'string') return new Uint8Array(Buffer.from(data, (enc || 'utf8') as BufferEncoding))
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.from(data))
  return new Uint8Array(0)
}

export function mkdirp(dir: string): string {
  const n = normalize(dir)
  tree.set('/', { dir: true, data: new Uint8Array(0) })
  let cur = ''
  for (const s of n.split('/')) {
    if (!s) continue
    cur += '/' + s
    const e = tree.get(cur)
    if (!e) tree.set(cur, { dir: true, data: new Uint8Array(0) })
  }
  return n
}

export function exists(p: string): boolean {
  const n = normalize(p)
  if (n === '/') return true
  return tree.has(n)
}

export function isDir(p: string): boolean {
  const n = normalize(p)
  if (n === '/') return true
  return !!tree.get(n)?.dir
}

export function readFile(path: string, enc?: string): Buffer | string {
  const e = tree.get(normalize(path))
  if (!e || e.dir) throw enoent(path)
  const buf = Buffer.from(e.data)
  return enc ? buf.toString(enc as BufferEncoding) : buf
}

export function writeFile(path: string, data: unknown, enc?: string): void {
  const n = normalize(path)
  mkdirp(dirname(n))
  tree.set(n, { dir: false, data: toBytes(data, enc) })
  touch()
}

export function appendFile(path: string, data: unknown, enc?: string): void {
  const n = normalize(path)
  mkdirp(dirname(n))
  const prev = tree.get(n)
  const add = toBytes(data, enc)
  const next = new Uint8Array((prev && !prev.dir ? prev.data.length : 0) + add.length)
  if (prev && !prev.dir) next.set(prev.data, 0)
  next.set(add, prev && !prev.dir ? prev.data.length : 0)
  tree.set(n, { dir: false, data: next })
  touch()
}

export function readdir(path: string): string[] {
  const n = normalize(path)
  if (!isDir(n)) throw enoent(path)
  const prefix = n === '/' ? '/' : n + '/'
  const names = new Set<string>()
  for (const key of tree.keys()) {
    if (!key.startsWith(prefix) || key === n) continue
    const rest = key.slice(prefix.length)
    if (!rest) continue
    names.add(rest.split('/')[0])
  }
  return [...names]
}

export function stat(path: string): { size: number; mtimeMs: number; isDir: boolean } {
  const n = normalize(path)
  if (n === '/') return { size: 0, mtimeMs: 0, isDir: true }
  const e = tree.get(n)
  if (!e) throw enoent(path)
  return { size: e.dir ? 0 : e.data.length, mtimeMs: 0, isDir: e.dir }
}

export function unlink(path: string): void {
  const n = normalize(path)
  const e = tree.get(n)
  if (!e || e.dir) throw enoent(path)
  tree.delete(n)
  touch()
}

export function remove(path: string, recursive: boolean): void {
  const n = normalize(path)
  const e = tree.get(n)
  if (!e) return
  if (e.dir) {
    for (const key of [...tree.keys()]) {
      if (key === n) continue
      if (key.startsWith(n + '/')) {
        tree.delete(key)
      }
    }
    const remaining = [...tree.keys()].some(k => k.startsWith(n + '/'))
    if (remaining && !recursive) throw new Error(`目录非空：${n}`)
    tree.delete(n)
  } else {
    tree.delete(n)
  }
  touch()
}

export function rename(from: string, to: string): void {
  const a = normalize(from)
  const b = normalize(to)
  const e = tree.get(a)
  if (!e) throw enoent(from)
  mkdirp(dirname(b))
  if (e.dir) {
    const moves: [string, string][] = [[a, b]]
    for (const key of [...tree.keys()]) {
      if (key.startsWith(a + '/')) moves.push([key, b + key.slice(a.length)])
    }
    for (const [src, dst] of moves) {
      const cur = tree.get(src)!
      tree.delete(src)
      tree.set(dst, cur)
    }
  } else {
    tree.delete(a)
    tree.set(b, e)
  }
  touch()
}

function enoent(path: string): Error {
  const e: any = new Error(`ENOENT: no such file or directory, open '${path}'`)
  e.code = 'ENOENT'
  return e
}

/* ---------------- IndexedDB 持久化 ---------------- */

let ready: Promise<void> = Promise.resolve()
let flushTimer: any = 0

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1)
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE)
    }
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })
}

export function initFs(): Promise<void> {
  ready = (async () => {
    mkdirp('/')
    try {
      const db = await openDb()
      const raw: any = await new Promise((res, rej) => {
        const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get('tree')
        rq.onsuccess = () => res(rq.result)
        rq.onerror = () => rej(rq.error)
      })
      db.close()
      if (Array.isArray(raw)) {
        for (const it of raw) {
          if (!it || typeof it.path !== 'string') continue
          tree.set(it.path, { dir: !!it.dir, data: it.data ? new Uint8Array(it.data) : new Uint8Array(0) })
        }
      }
    } catch {
      /* 无 IndexedDB（冒烟测试/隐私模式）：退化为纯内存 */
    }
  })()
  return ready
}

export function fsReady(): Promise<void> {
  return ready
}

export async function flushNow(): Promise<void> {
  try {
    const db = await openDb()
    const items = [...tree].map(([path, e]) => ({ path, dir: e.dir, data: e.data }))
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(items, 'tree')
    await txDone(tx)
    db.close()
  } catch {
    /* ignore */
  }
}

function touch(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = 0
    void flushNow()
  }, 400)
}

/** 用内置音源播种虚拟目录（内容由打包期的 ?raw 导入提供） */
export function seed(files: Record<string, string>): void {
  for (const [name, code] of Object.entries(files)) {
    writeFile(`/starwish/sources/${name}`, code, 'utf8')
  }
}
