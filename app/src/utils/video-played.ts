/**
 * 视频播放足迹（v1.0.0 · 用户口径：B站/MV 播放后视频中心还存在播放按钮图标没有隐去）
 *
 * 视频中心（Mv 聚合页）卡片右上有一个居中播放按钮浮层；用户点开播放返回后
 * 该图标仍原样显示，无法区分「看过」。现在播放页打开视频时登记足迹，
 * 列表页据此隐去播放按钮（保留来源角标/时长/播放量）。
 *
 * 存储：localStorage `sw.video.played`（最多 500 条 LRU），全端共用一份 key，
 * 桌面/移动从同一入口读写，跨页即时生效（事件通知）。
 */

const KEY = 'sw.video.played'
const MAX = 500
const EVT = 'sw-video-played'

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)))
  } catch {
    /* 配额满忽略 */
  }
}

/** 登记播放足迹（MvPlayer 打开视频时调用；重复登记自动去重置顶） */
export function markVideoPlayed(id: string): void {
  const key = String(id || '').trim()
  if (!key) return
  const ids = read().filter(x => x !== key)
  ids.unshift(key)
  write(ids)
  window.dispatchEvent(new CustomEvent(EVT, { detail: key }))
}

/** 是否已播放 */
export function isVideoPlayed(id: string): boolean {
  const key = String(id || '').trim()
  if (!key) return false
  return read().includes(key)
}

/** 订阅足迹变化（列表页刷新隐去状态用）；返回取消订阅函数 */
export function onVideoPlayed(cb: (id: string) => void): () => void {
  const h = (e: Event): void => cb(String((e as CustomEvent).detail || ''))
  window.addEventListener(EVT, h)
  return () => window.removeEventListener(EVT, h)
}
