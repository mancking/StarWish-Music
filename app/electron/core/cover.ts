import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { protocol, net } from 'electron'
import type { Song } from '../../shared/types'
import { coverCacheDir } from './paths'
import { createLogger } from './log'
import { itunesCover } from './providers'
import { lxHost } from './lx-host'

const logger = createLogger('cover')

const MEM_LIMIT = 60
const mem = new Map<string, { buf: Buffer; type: string }>()

function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex')
}

function extFromType(t: string): string {
  if (t.includes('png')) return '.png'
  if (t.includes('webp')) return '.webp'
  if (t.includes('gif')) return '.gif'
  return '.jpg'
}

function refererFor(url: string): string {
  try {
    const h = new URL(url).hostname
    if (h.includes('126.net') || h.includes('163.com')) return 'https://music.163.com/'
    if (h.includes('gtimg.cn') || h.includes('qq.com')) return 'https://y.qq.com/'
    if (h.includes('kugou.com')) return 'https://www.kugou.com/'
    if (h.includes('kuwo.cn')) return 'http://www.kuwo.cn/'
    if (h.includes('bilibili.com') || h.includes('hdslb.com')) return 'https://www.bilibili.com/'
    if (h.includes('migu.cn')) return 'https://music.migu.cn/'
    if (h.includes('itunes.apple.com') || h.includes('mzstatic.com')) return 'https://music.apple.com/'
  } catch {
    /* ignore */
  }
  return ''
}

/** 把任意远端/本地封面转成渲染进程可直接使用的自定义协议地址 */
export function coverProtocolUrl(remoteUrl: string): string {
  return `swcover://covers/r/${encodeURIComponent(remoteUrl)}`
}

export function localCoverProtocolUrl(fileName: string): string {
  return `swcover://covers/l/${encodeURIComponent(fileName)}`
}

export function registerCoverProtocol(): void {
  protocol.handle('swcover', async req => {
    try {
      const u = new URL(req.url)
      const seg = u.pathname.replace(/^\//, '')
      if (seg.startsWith('l/')) {
        const name = decodeURIComponent(seg.slice(2))
        const safe = path.basename(name)
        const file = path.join(coverCacheDir(), safe)
        if (!fs.existsSync(file)) return new Response('', { status: 404 })
        const buf = fs.readFileSync(file)
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: {
            'Content-Type': safe.endsWith('.png') ? 'image/png' : 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
      if (!seg.startsWith('r/')) return new Response('', { status: 400 })
      const remote = decodeURIComponent(seg.slice(2))
      if (!/^https?:\/\//i.test(remote)) return new Response('', { status: 400 })

      const key = hash(remote)
      const cachedMem = mem.get(key)
      if (cachedMem) {
        return new Response(new Uint8Array(cachedMem.buf), {
          status: 200,
          headers: {
            'Content-Type': cachedMem.type,
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
      // 磁盘缓存
      const files = fs.readdirSync(coverCacheDir()).filter(f => f.startsWith(key))
      if (files.length) {
        const f = path.join(coverCacheDir(), files[0])
        const buf = fs.readFileSync(f)
        const type = f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
        pushMem(key, buf, type)
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: {
            'Content-Type': type,
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }

      const referer = refererFor(remote)
      const reqHeaders = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ...(referer ? { Referer: referer } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      }
      let res: Response
      try {
        res = await fetch(remote, { headers: reqHeaders, redirect: 'follow' })
      } catch {
        res = await net.fetch(remote, { headers: reqHeaders })
      }
      if (!res.ok) {
        logger.warn('封面下载失败', res.status, remote.slice(0, 120))
        return new Response('', { status: 404 })
      }
      const type = res.headers.get('content-type') || 'image/jpeg'
      if (!type.startsWith('image/')) return new Response('', { status: 404 })
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 200) return new Response('', { status: 404 })
      try {
        fs.writeFileSync(path.join(coverCacheDir(), key + extFromType(type)), buf)
      } catch {
        /* 缓存写失败不影响显示 */
      }
      pushMem(key, buf, type)
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (e: any) {
      logger.warn('封面协议异常', e?.message)
      return new Response('', { status: 500 })
    }
  })
}

function pushMem(key: string, buf: Buffer, type: string): void {
  if (mem.size >= MEM_LIMIT) {
    const first = mem.keys().next().value
    if (first) mem.delete(first)
  }
  mem.set(key, { buf, type })
}

/** 保存内嵌封面（本地音乐扫描时调用），返回协议地址 */
export function saveEmbeddedCover(data: Uint8Array, mime: string, seed: string): string {
  try {
    const name = hash(seed) + extFromType(mime || 'image/jpeg')
    const file = path.join(coverCacheDir(), name)
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(data))
    return localCoverProtocolUrl(name)
  } catch {
    return ''
  }
}

const resolving = new Map<string, Promise<string>>()

/**
 * 多级封面回退：本地/音源字段 → 插件 pic → iTunes。
 * 结果会缓存，避免列表滚动时重复请求。
 */
export async function resolveCoverUrl(song: Song): Promise<string> {
  if (!song) return ''
  const cached = coverResolved.get(song.id)
  if (cached) return cached
  if (resolving.has(song.id)) return resolving.get(song.id)!

  const p = (async () => {
    let url = ''
    if (song.pic) {
      if (song.pic.startsWith('swcover://')) {
        coverResolved.set(song.id, song.pic)
        return song.pic
      }
      url = song.pic
    }
    if (!url) {
      try {
        url = await lxHost.getPic(song)
      } catch {
        /* ignore */
      }
    }
    if (!url) {
      try {
        url = await itunesCover(`${song.name} ${song.singer}`.trim())
      } catch {
        /* ignore */
      }
    }
    const final = url ? coverProtocolUrl(url) : ''
    if (final) coverResolved.set(song.id, final)
    return final
  })()

  resolving.set(song.id, p)
  try {
    return await p
  } finally {
    resolving.delete(song.id)
  }
}

const coverResolved = new Map<string, string>()

export function clearCoverCache(): void {
  mem.clear()
  coverResolved.clear()
  try {
    for (const f of fs.readdirSync(coverCacheDir())) {
      fs.unlinkSync(path.join(coverCacheDir(), f))
    }
  } catch {
    /* ignore */
  }
}

export function coverCacheSize(): number {
  try {
    return fs.readdirSync(coverCacheDir()).reduce((sum, f) => {
      try {
        return sum + fs.statSync(path.join(coverCacheDir(), f)).size
      } catch {
        return sum
      }
    }, 0)
  } catch {
    return 0
  }
}
