/**
 * 移动端播放器：单个隐藏 <audio> 元素承载真实播放。
 *
 * 桌面用 player-service（BrowserWindow + 独立渲染进程 + 淡入淡出 + 缓冲
 * 看门狗）；WebView 里这些都不存在，但 renderer 只依赖 PlayerState 形状和
 * 四个事件，所以这里用最小实现复刻同样的契约：
 *   - setQueue/playAt/toggle/next/prev/seek/volume/mute/mode/rate/quality
 *   - sleep 定时、addNext/addQueue/removeAt/move/clearQueue
 *   - 发 player:state / player:tick / player:error / player:sleep
 * 取流走 `resolveUrl`（保留品质链 + 自动换源兜底），与桌面同一条路径。
 */
import type { PlayMode, PlayerState, Song } from '@shared/types'
import { resolveUrl } from '../../electron/core/music-service'
import { getSettings, saveSettings } from '../../electron/core/settings'
import { addHistory } from '../../electron/core/db'
import { emit } from './bus'

const el = new Audio()
el.preload = 'auto'
el.crossOrigin = 'anonymous'

let queue: Song[] = []
let index = -1
let status: PlayerState['status'] = 'idle'
let error: string | null = null
let position = 0
let duration = 0
let buffered = 0
let sleepUntil = 0
let retryCount = 0
const MAX_RETRY = 2

function state(): PlayerState {
  return {
    status,
    song: index >= 0 ? queue[index] || null : null,
    index,
    position,
    duration: duration || (index >= 0 ? queue[index]?.duration || 0 : 0),
    buffered,
    volume: el.volume,
    muted: el.muted,
    mode: getSettings().playMode,
    quality: getSettings().quality,
    rate: el.playbackRate || 1,
    error,
    queue,
  }
}

function publish(): void {
  emit('player:state', state())
}

function tick(): void {
  position = el.currentTime || 0
  try {
    if (el.buffered.length) buffered = el.buffered.end(el.buffered.length - 1)
  } catch { /* ignore */ }
  emit('player:tick', { position, duration, buffered, status })
}

let tickTimer = 0
function startTick(): void {
  if (tickTimer) return
  tickTimer = window.setInterval(tick, 500)
}
function stopTick(): void {
  if (!tickTimer) return
  window.clearInterval(tickTimer)
  tickTimer = 0
}

async function load(i: number, autoplay = true): Promise<void> {
  if (i < 0 || i >= queue.length) {
    status = 'idle'
    error = null
    position = 0
    duration = 0
    publish()
    return
  }
  index = i
  const song = queue[i]
  status = 'loading'
  error = null
  position = 0
  duration = 0
  publish()
  try {
    const r = await resolveUrl(song, getSettings().quality, getSettings().autoSwitchSource)
    if (index !== i) return // 已切歌
    el.src = r.url
    el.playbackRate = state().rate
    retryCount = 0
    if (autoplay) await el.play()
    status = el.paused ? 'paused' : 'playing'
  } catch (e: any) {
    if (index !== i) return
    // 与桌面一致：同曲重试 N 次后跳下一首，连续失败暂停提示
    if (retryCount < MAX_RETRY) {
      retryCount++
      void load(i, autoplay)
      return
    }
    retryCount = 0
    status = 'error'
    error = e?.message || '播放失败'
    emit('player:error', { message: error, song })
    publish()
    if (getSettings().skipOnError) next(false)
  }
}

function next(auto = false): void {
  if (!queue.length) return
  const mode = getSettings().playMode
  if (auto && mode === 'repeat-one') { void load(index, true); return }
  if (mode === 'shuffle') {
    void load(Math.floor(Math.random() * queue.length), true)
    return
  }
  let i = index + 1
  if (i >= queue.length) {
    if (mode === 'order') { status = 'stopped'; publish(); return }
    i = 0
  }
  void load(i, true)
}

function prev(): void {
  if (!queue.length) return
  let i = index - 1
  if (i < 0) i = queue.length - 1
  void load(i, true)
}

/* ---------------- audio 事件 ---------------- */
el.addEventListener('playing', () => { status = 'playing'; error = null; startTick(); publish() })
el.addEventListener('pause', () => { status = 'paused'; stopTick(); publish() })
el.addEventListener('waiting', () => { status = 'loading'; publish() })
el.addEventListener('ratechange', () => publish())
el.addEventListener('volumechange', () => publish())
el.addEventListener('error', () => {
  if (!el.src) return
  if (retryCount < MAX_RETRY) { retryCount++; void load(index, true); return }
  status = 'error'
  error = '音频加载失败，可能链接已失效'
  emit('player:error', { message: error, song: state().song })
  publish()
  if (getSettings().skipOnError) next(false)
})
el.addEventListener('ended', () => {
  const song = state().song
  if (song) addHistory(song, Math.round(position * 1000))
  stopTick()
  next(true)
})
el.addEventListener('timeupdate', tick)
el.addEventListener('progress', tick)

/* ---------------- 频道实现 ---------------- */
export const player = {
  init(): void {
    const s = getSettings()
    el.volume = typeof s.volume === 'number' ? s.volume : 0.8
    publish()
  },

  getState(): PlayerState { return state() },

  setQueue(songs: Song[], i = 0, autoplay = true): PlayerState {
    queue = songs || []
    if (i < 0 || i >= queue.length) { index = i; publish(); return state() }
    void load(i, autoplay)
    return state()
  },

  playAt(i: number, autoplay = true): PlayerState {
    void load(Number(i) || 0, autoplay)
    return state()
  },

  playNow(song: Song, songs?: Song[], i?: number): PlayerState {
    if (songs && songs.length) {
      queue = songs
      const idx = typeof i === 'number' ? i : songs.findIndex(s => s.id === song.id)
      void load(Math.max(0, idx), true)
      return state()
    }
    const cur = queue.findIndex(s => s.id === song.id)
    if (cur >= 0) return player.playAt(cur, true)
    queue = [...queue, song]
    return player.playAt(queue.length - 1, true)
  },

  toggle(): PlayerState {
    if (!queue.length) return state()
    if (el.paused) { void el.play().catch(() => undefined) } else { el.pause() }
    return state()
  },

  next(auto = false): void { next(auto) },
  prev(): void { prev() },

  seek(t: number): boolean {
    el.currentTime = Math.max(0, Number(t) || 0)
    position = el.currentTime
    tick()
    return true
  },

  setVolume(v: number): PlayerState { el.volume = Math.min(1, Math.max(0, v)); return state() },
  setMuted(m: boolean): PlayerState { el.muted = !!m; return state() },
  setMode(mode: PlayMode): PlayerState { saveSettings({ playMode: mode }); publish(); return state() },
  setRate(rate: number): PlayerState { el.playbackRate = Number(rate) || 1; return state() },
  setQuality(q: string): PlayerState {
    saveSettings({ quality: q as any })
    // 与桌面一致：品质变化即时重取链
    if (index >= 0 && !el.paused) void load(index, true)
    else publish()
    return state()
  },

  setSleepTimer(minutes: number): { until: number } {
    if (!minutes) { sleepUntil = 0; emit('player:sleep', { until: 0 }); return { until: 0 } }
    sleepUntil = Date.now() + Math.round(minutes * 60000)
    emit('player:sleep', { until: sleepUntil })
    return { until: sleepUntil }
  },

  getSleepUntil(): number { return sleepUntil },

  addNext(song: Song): PlayerState {
    queue.splice(index + 1, 0, song)
    publish()
    return state()
  },

  addToQueue(songs: Song[]): PlayerState {
    queue = [...queue, ...(songs || [])]
    publish()
    return state()
  },

  removeAt(i: number): PlayerState {
    const n = Number(i)
    if (n < 0 || n >= queue.length) return state()
    const wasCurrent = n === index
    queue.splice(n, 1)
    if (wasCurrent) {
      el.pause()
      el.removeAttribute('src')
      void load(Math.min(n, queue.length - 1), true)
    } else if (n < index) {
      index -= 1
      publish()
    } else {
      publish()
    }
    return state()
  },

  moveItem(from: number, to: number): PlayerState {
    const f = Number(from), t = Number(to)
    if (f < 0 || t < 0 || f >= queue.length || t >= queue.length || f === t) return state()
    const [s] = queue.splice(f, 1)
    queue.splice(t, 0, s)
    if (f === index) index = t
    else if (f < index && t >= index) index -= 1
    else if (f > index && t <= index) index += 1
    publish()
    return state()
  },

  clearQueue(): PlayerState {
    el.pause()
    el.removeAttribute('src')
    queue = []
    index = -1
    status = 'stopped'
    stopTick()
    publish()
    return state()
  },

  /** 睡眠关机检查由桥的定时器驱动 */
  checkSleep(): void {
    if (sleepUntil && Date.now() >= sleepUntil) {
      el.pause()
      sleepUntil = 0
      emit('player:sleep', { until: 0 })
      publish()
    }
  },
}
