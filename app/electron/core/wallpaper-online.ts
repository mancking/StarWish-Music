import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from './paths'
import { getSettings } from './settings'
import { request } from './http'
import { createLogger } from './log'

const logger = createLogger('wallpaper-online')

/**
 * 开源壁纸在线拉取
 *
 * 数据源链：Pixabay（主，需 key）→ Pexels（备，需 key）→ Picsum 随机精选（兜底，无 key）
 * → 本地壁纸库（最终降级，由渲染层处理）。
 * - 打开即默认列表（不空白）：无搜索词按 最新/热门 排序拉取；
 * - 搜索 = 过滤增强（输入即过滤、清空回默认，非列表前提）；
 * - 24 条/页 + 显式「加载更多」（3.15.7 口径）；骨架屏/失败重试由渲染层实现；
 * - key 存主进程 settings（不进前端 bundle），设置页可选填写；
 * - 搜索 JSON 缓存 24h（Pixabay ToS 强制 ≥24h）；
 * - 下载原图 ≤10MB 并发 ≤2，缓存 ≤50 张/500MB/30 天（LRU 由文件 mtime 近似）；
 * - 合规：仅无版权/可商用免授权源，不内置侵权内容。
 */

export interface OnlineWallpaper {
  id: string
  thumb: string
  full: string
  w: number
  h: number
  source: 'pixabay' | 'pexels' | 'picsum'
  author?: string
}

function cacheDir(): string {
  const d = path.join(userDataDir(), 'wallpaper-cache')
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {
    /* ignore */
  }
  return d
}

function jsonCachePath(key: string): string {
  return path.join(cacheDir(), `list-${cryptoHash(key)}.json`)
}

function cryptoHash(s: string): string {
  // 轻量 FNV，避免仅为缓存键引入 crypto
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16) + s.length.toString(16)
}

const DAY_MS = 24 * 3600_000

function readJsonCache(key: string): OnlineWallpaper[] | null {
  try {
    const p = jsonCachePath(key)
    const st = fs.statSync(p)
    if (Date.now() - st.mtimeMs > DAY_MS) return null
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

function writeJsonCache(key: string, list: OnlineWallpaper[]): void {
  try {
    fs.writeFileSync(jsonCachePath(key), JSON.stringify(list), 'utf8')
  } catch {
    /* ignore */
  }
}

async function fetchPixabay(q: string, page: number): Promise<OnlineWallpaper[]> {
  const key = String((getSettings() as any).pixabayKey || '').trim()
  if (!key) throw new Error('未配置 Pixabay key')
  const params = new URLSearchParams({ key, per_page: '24', page: String(page), safesearch: 'true' })
  if (q) params.set('q', q)
  else params.set('order', 'popular')
  const res = await request(`https://pixabay.com/api/?${params.toString()}`, { timeout: 15000 })
  const hits: any[] = res.body?.hits || []
  return hits
    .filter(h => h?.previewURL && h?.largeImageURL)
    .map(h => ({
      id: `px-${h.id}`,
      thumb: String(h.webformatURL || h.previewURL),
      full: String(h.largeImageURL),
      w: Number(h.imageWidth || 0),
      h: Number(h.imageHeight || 0),
      source: 'pixabay' as const,
      author: String(h.user || ''),
    }))
}

async function fetchPexels(q: string, page: number): Promise<OnlineWallpaper[]> {
  const key = String((getSettings() as any).pexelsKey || '').trim()
  if (!key) throw new Error('未配置 Pexels key')
  const url = q
    ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24&page=${page}`
    : `https://api.pexels.com/v1/curated?per_page=24&page=${page}`
  const res = await request(url, { headers: { Authorization: key }, timeout: 15000 })
  const photos: any[] = res.body?.photos || []
  return photos
    .filter(p => p?.src?.medium && p?.src?.large2x)
    .map(p => ({
      id: `pl-${p.id}`,
      thumb: String(p.src.medium),
      full: String(p.src.large2x),
      w: Number(p.width || 0),
      h: Number(p.height || 0),
      source: 'pexels' as const,
      author: String(p.photographer || ''),
    }))
}

/** 无 key 兜底：Picsum 精选列表（无关键词搜索，仅默认列表/分页） */
async function fetchPicsum(page: number): Promise<OnlineWallpaper[]> {
  const res = await request(`https://picsum.photos/v2/list?page=${page}&limit=24`, { timeout: 15000 })
  const items: any[] = Array.isArray(res.body) ? res.body : []
  return items
    .filter(x => x?.download_url)
    .map(x => ({
      id: `ps-${x.id}`,
      thumb: `https://picsum.photos/id/${x.id}/320/180`,
      full: String(x.download_url),
      w: Number(x.width || 0),
      h: Number(x.height || 0),
      source: 'picsum' as const,
      author: String(x.author || ''),
    }))
}

/**
 * 打开即默认列表 / 搜索过滤（语义）。
 * 返回 {list, source, degraded}：degraded = 上游全部不可达（渲染层提示降级本地库）。
 */
export async function listOnlineWallpapers(opts: { page?: number; q?: string; refresh?: boolean }): Promise<{ list: OnlineWallpaper[]; source: string; degraded: boolean; end: boolean }> {
  const page = Math.max(1, Number(opts.page) || 1)
  const q = String(opts.q || '').trim()
  const cacheKey = `${q}|${page}`
  if (!opts.refresh) {
    const cached = readJsonCache(cacheKey)
    if (cached && cached.length) return { list: cached, source: 'cache', degraded: false, end: cached.length < 24 }
  }
  const errors: string[] = []
  // 主：Pixabay（有 key 时）→ 备：Pexels（有 key 时）→ 兜底：Picsum（无 key 可用，仅无搜索词）
  if ((getSettings() as any).pixabayKey) {
    try {
      const list = await fetchPixabay(q, page)
      if (list.length) {
        writeJsonCache(cacheKey, list)
        return { list, source: 'pixabay', degraded: false, end: list.length < 24 }
      }
    } catch (e: any) {
      errors.push(`pixabay:${e?.message || e}`)
    }
  }
  if ((getSettings() as any).pexelsKey) {
    try {
      const list = await fetchPexels(q, page)
      if (list.length) {
        writeJsonCache(cacheKey, list)
        return { list, source: 'pexels', degraded: false, end: list.length < 24 }
      }
    } catch (e: any) {
      errors.push(`pexels:${e?.message || e}`)
    }
  }
  if (!q) {
    try {
      const list = await fetchPicsum(page)
      if (list.length) {
        writeJsonCache(cacheKey, list)
        return { list, source: 'picsum', degraded: false, end: list.length < 24 }
      }
    } catch (e: any) {
      errors.push(`picsum:${e?.message || e}`)
    }
  }
  logger.warn('开源壁纸全部上游不可达', errors.join(' | '))
  return { list: [], source: 'none', degraded: true, end: true }
}

/** 下载原图（≤10MB，超限/失败抛错）；缓存目录 LRU：≤50 张/500MB/30 天 */
export async function downloadOnlineWallpaper(url: string): Promise<{ file: string }> {
  const res = await request(url, { timeout: 30000, binary: true })
  const data: Buffer | undefined = res.bytes
  if (!data || !data.length) throw new Error('下载内容为空')
  if (data.length > 10 * 1024 * 1024) throw new Error('原图超过 10MB 上限')
  const dir = path.join(cacheDir(), 'originals')
  fs.mkdirSync(dir, { recursive: true })
  pruneOriginals(dir)
  const name = `wp-${cryptoHash(url)}-${Date.now()}.jpg`
  const file = path.join(dir, name)
  fs.writeFileSync(file, data)
  return { file }
}

function pruneOriginals(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .map(f => {
        const p = path.join(dir, f)
        const st = fs.statSync(p)
        return { p, at: st.mtimeMs, size: st.size }
      })
      .sort((a, b) => b.at - a.at)
    // 30 天过期 + ≤50 张 + ≤500MB
    const now = Date.now()
    let count = 0
    let bytes = 0
    for (const f of files) {
      const expired = now - f.at > 30 * DAY_MS
      if (expired || count >= 50 || bytes + f.size > 500 * 1024 * 1024) {
        try {
          fs.rmSync(f.p, { force: true })
        } catch {
          /* ignore */
        }
        continue
      }
      count++
      bytes += f.size
    }
  } catch {
    /* ignore */
  }
}

/** 缓存占用统计（设置页缓存管理：展示占用 + 一键清理） */
export function wallpaperCacheSize(): { bytes: number; files: number } {
  const walk = (d: string): { bytes: number; files: number } => {
    let bytes = 0
    let files = 0
    try {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f)
        const st = fs.statSync(p)
        if (st.isDirectory()) {
          const r = walk(p)
          bytes += r.bytes
          files += r.files
        } else {
          bytes += st.size
          files++
        }
      }
    } catch {
      /* ignore */
    }
    return { bytes, files }
  }
  return walk(cacheDir())
}

export function clearWallpaperCache(): { ok: boolean } {
  try {
    const d = cacheDir()
    for (const f of fs.readdirSync(d)) {
      fs.rmSync(path.join(d, f), { force: true, recursive: true })
    }
    return { ok: true }
  } catch (e: any) {
    throw new Error(`清理失败：${e?.message || e}`)
  }
}
