/** node:fs 的浏览器垫片：全部落到虚拟文件系统 */
import { Buffer } from 'buffer'
import * as vfs from './vfs'

export class Dirent {
  name: string
  constructor(name: string) {
    this.name = name
  }
  isDirectory(): boolean {
    return false
  }
  isFile(): boolean {
    return true
  }
}

export class Stats {
  size: number
  mtimeMs = 0
  mtime = new Date(0)
  birthtimeMs = 0
  private dir: boolean
  constructor(size: number, dir: boolean) {
    this.size = size
    this.dir = dir
  }
  isDirectory(): boolean {
    return this.dir
  }
  isFile(): boolean {
    return !this.dir
  }
  isSymbolicLink(): boolean {
    return false
  }
  isBlockDevice(): boolean {
    return false
  }
  isCharacterDevice(): boolean {
    return false
  }
  isFIFO(): boolean {
    return false
  }
  isSocket(): boolean {
    return false
  }
}

export class WriteStream {
  path: string
  bytesWritten = 0
  constructor(p: string) {
    this.path = p
  }
  write(chunk: unknown): boolean {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk as Uint8Array)
    vfs.appendFile(this.path, buf)
    this.bytesWritten += buf.length
    return true
  }
  end(chunk?: unknown): void {
    if (chunk !== undefined) this.write(chunk)
  }
  on(): this {
    return this
  }
  once(): this {
    return this
  }
  emit(): boolean {
    return false
  }
  destroy(): void {
    /* noop */
  }
  close(): void {
    /* noop */
  }
}

export function existsSync(p: string): boolean {
  return vfs.exists(String(p))
}
export function readFileSync(p: string, enc?: any): any {
  return vfs.readFile(String(p), typeof enc === 'string' ? enc : undefined)
}
export function writeFileSync(p: string, data: unknown, enc?: any): void {
  vfs.writeFile(String(p), data, typeof enc === 'string' ? enc : undefined)
}
export function appendFileSync(p: string, data: unknown, enc?: any): void {
  vfs.appendFile(String(p), data, typeof enc === 'string' ? enc : undefined)
}
export function mkdirSync(p: string, _opts?: any): void {
  vfs.mkdirp(String(p))
}
export function readdirSync(p: string, _opts?: any): string[] {
  return vfs.readdir(String(p))
}
export function renameSync(from: string, to: string): void {
  vfs.rename(String(from), String(to))
}
export function statSync(p: string, _opts?: any): Stats {
  const s = vfs.stat(String(p))
  return new Stats(s.size, s.isDir)
}
export function lstatSync(p: string): Stats {
  return statSync(p)
}
export function unlinkSync(p: string): void {
  vfs.unlink(String(p))
}
export function rmdirSync(p: string): void {
  vfs.remove(String(p), false)
}
export function rmSync(p: string, opts?: any): void {
  vfs.remove(String(p), !!(opts && opts.recursive))
}
export function copyFileSync(from: string, to: string): void {
  vfs.writeFile(String(to), vfs.readFile(String(from)))
}
export function createWriteStream(p: string, _opts?: any): WriteStream {
  return new WriteStream(String(p))
}
export function createReadStream(p: string): any {
  const buf = Buffer.from(vfs.readFile(String(p)) as Buffer)
  const handlers: Record<string, ((...a: any[]) => void)[]> = {}
  setTimeout(() => {
    handlers.data?.forEach(fn => fn(buf))
    handlers.end?.forEach(fn => fn())
  }, 0)
  const stream: any = {
    on(ev: string, fn: (...a: any[]) => void) {
      ;(handlers[ev] ||= []).push(fn)
      return stream
    },
    destroy() {
      /* noop */
    },
  }
  return stream
}

const fs = {
  Dirent,
  Stats,
  WriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  lstatSync,
  unlinkSync,
  rmdirSync,
  rmSync,
  copyFileSync,
  createWriteStream,
  createReadStream,
}

export default fs
