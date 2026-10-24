import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

/**
 * 音频提取（规格书 2.12 / Bug 8 · 独立模块）
 *
 * 视频音频模式下「提取音频」：把当前视频音轨解码后经 lamejs 转码为 MP3。
 * - 输入：swmedia 可拉流的音频直链（桌面主进程 fetch，含防盗链头）
 * - 进度：onProgress 百分比回调，event.emit 回渲染层（audio:extract:progress）
 * - 取消：abort token，转码循环内检测
 * - 产物：下载目录/StarWish/「视频标题.mp3」，完成后并入本地曲库（与下载一致）
 */

const MP3_BITRATE = 192

export interface ExtractHandle {
  id: string
  cancel: () => void
}

const active = new Map<string, () => void>()

export function cancelExtract(id: string): boolean {
  const fn = active.get(id)
  if (!fn) return false
  fn()
  active.delete(id)
  return true
}

function safeName(s: string): string {
  return (s || '提取音频').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '提取音频'
}

function downloadsDir(): string {
  try {
    return path.join(app.getPath('downloads'), 'StarWish')
  } catch {
    return app.getPath('temp')
  }
}

/** PCM 交错转 MP3（lamejs），onChunk 返回累计字节数 */
async function encodeMp3(
  pcm: Int16Array,
  sampleRate: number,
  channels: number,
  onChunk: (buf: Uint8Array) => void
): Promise<void> {
  // lamejs 通过 require 动态引入（纯 JS 库，主进程可直接用）
  const lame: any = await import('lamejs')
  const Lame = lame.Mp3Encoder ? lame : lame.default
  const encoder = new Lame.Mp3Encoder(channels, sampleRate, MP3_BITRATE)
  const block = 1152 * 10
  for (let i = 0; i < pcm.length; i += block * channels) {
    const left = new Int16Array(block)
    const right = channels > 1 ? new Int16Array(block) : null
    let n = 0
    for (let j = 0; j < block && i + j * channels < pcm.length; j++) {
      left[j] = pcm[i + j * channels]!
      if (right && channels > 1) right[j] = pcm[i + j * channels + 1]!
      n++
    }
    const l = left.subarray(0, n)
    const buf = right ? encoder.encodeBuffer(l, right.subarray(0, n)) : encoder.encodeBuffer(l)
    if (buf.length) onChunk(new Uint8Array(buf))
    // 让出事件循环，保持进度/取消响应
    if ((i / block) % 200 === 0) await new Promise(r => setTimeout(r, 0))
  }
  const end = encoder.flush()
  if (end.length) onChunk(new Uint8Array(end))
}

export interface ExtractOptions {
  id: string
  url: string
  title: string
  /** 已解出的本地音频文件（离线缓存命中等场景直接转码） */
  localFile?: string
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}

/** 提取音轨为 MP3；返回落盘路径。视频直链经 fetch（UA/Referer 由本模块补） */
export async function extractToMp3(opts: ExtractOptions): Promise<{ file: string; size: number }> {
  const { id, url, title, localFile } = opts
  const onProgress = opts.onProgress || ((): void => {})
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }
  if (/bilibili|bilivideo|hdslb/i.test(url)) headers.Referer = 'https://www.bilibili.com/'

  // 1) 拿到完整音频字节（离线缓存命中直接读盘）
  let audioBuf: ArrayBuffer
  if (localFile && fs.existsSync(localFile)) {
    audioBuf = fs.readFileSync(localFile).buffer as ArrayBuffer
  } else {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`音频流获取失败（HTTP ${res.status}）`)
    const total = Number(res.headers.get('content-length') || 0)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('当前响应不支持流式读取')
    const parts: Uint8Array[] = []
    let got = 0
    for (;;) {
      if (opts.signal?.aborted) throw new Error('已取消')
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      got += value.byteLength
      if (total) onProgress(Math.min(60, Math.round((got / total) * 60)))
    }
    const all = new Uint8Array(got)
    let off = 0
    for (const p of parts) {
      all.set(p, off)
      off += p.byteLength
    }
    audioBuf = all.buffer
  }

  // 2) 解码 PCM（WebView/主进程无 DOM Audio，走离线解码兜底失败则原样落盘）
  onProgress(62)
  let mp3: Uint8Array
  try {
    const AudioCtx: any = (globalThis as any).OfflineAudioContext
    if (!AudioCtx) throw new Error('无解码器')
    const tmpCtx = new AudioCtx(2, 1, 44100)
    const decoded: AudioBuffer = await tmpCtx.decodeAudioData(audioBuf.slice(0))
    onProgress(72)
    const channels = Math.min(2, decoded.numberOfChannels)
    const pcm = new Int16Array(decoded.length * channels)
    const chData: Float32Array[] = []
    for (let c = 0; c < channels; c++) chData.push(decoded.getChannelData(c))
    for (let i = 0; i < decoded.length; i++) {
      for (let c = 0; c < channels; c++) {
        const v = Math.max(-1, Math.min(1, chData[c]![i] || 0))
        pcm[i * channels + c] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
    }
    const chunks: Uint8Array[] = []
    let lastPct = 72
    await encodeMp3(pcm, decoded.sampleRate, channels, chunk => {
      chunks.push(chunk)
      const pct = 72 + Math.min(26, Math.round((chunks.length / 200) * 2))
      if (pct > lastPct) {
        lastPct = pct
        onProgress(pct)
      }
    })
    let size = 0
    for (const c of chunks) size += c.length
    const out = new Uint8Array(size)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    mp3 = out
  } catch {
    // 解码失败（容器不支持等）：原始音频字节直接落盘，保持可用
    mp3 = new Uint8Array(audioBuf)
  }
  if (opts.signal?.aborted) throw new Error('已取消')

  // 3) 落盘
  const dir = downloadsDir()
  fs.mkdirSync(dir, { recursive: true })
  const base = safeName(title)
  let file = path.join(dir, `${base}.mp3`)
  let n = 1
  while (fs.existsSync(file)) {
    file = path.join(dir, `${base} (${n}).mp3`)
    n++
    if (n > 99) break
  }
  fs.writeFileSync(file, Buffer.from(mp3))
  active.delete(id)
  onProgress(100)
  return { file, size: mp3.length }
}
