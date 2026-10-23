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
import { isNativeWebView } from './shims/util'

const el = new Audio()
el.preload = 'auto'
// ponytail: 不设 crossOrigin——媒体走 <audio> 直载无需 CORS，
// 设置后真机 CDN 不带 ACAO 会整条拒载（"no supported source" 根因）；Web Audio 未使用

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
/** 本曲已失败的音源（取链/媒体报错时累计，换源重试时跳过） */
let failedSources: string[] = []
let lastSource = ''
/** 连续「换源用尽后跳下一首」仍失败的歌曲数，播放成功即清零（与桌面一致） */
let consecutiveFails = 0

/** HTMLMediaElement 原生错误是英文，统一映射为中文提示 */
function friendlyPlayError(msg?: string): string | null {
  if (!msg) return null
  if (/no supported source|failed to load|unsupported|src/i.test(msg)) return '音频加载失败，可能链接已失效'
  if (/notallowed|blocked|user didn/i.test(msg)) return '播放被系统阻止，请手动点击播放'
  if (/aborted|interrupted/i.test(msg)) return '播放被中断，请重试'
  if (/network|fetch/i.test(msg)) return '网络异常，音频加载失败'
  return /[一-龥]/.test(msg) ? msg : '播放失败'
}

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

/**
 * @param keepFailures 内部重试链专用：保留 failedSources / retryCount；
 *   外部点播（换歌、重点当前曲、切下一首）一律 fresh，与桌面 playAt 重置一致
 */
async function load(i: number, autoplay = true, keepFailures = false): Promise<void> {
  if (i < 0 || i >= queue.length) {
    status = 'idle'
    error = null
    position = 0
    duration = 0
    publish()
    return
  }
  if (!keepFailures) {
    failedSources = []
    retryCount = 0
  }
  index = i
  const song = queue[i]
  status = 'loading'
  error = null
  position = 0
  duration = 0
  publish()
  try {
    const r = await resolveUrl(song, getSettings().quality, getSettings().autoSwitchSource, failedSources)
    if (index !== i) return // 已切歌
    lastSource = r.matched?.source || song.source
    // 真机走原生 /swmedia/ 代理（注入 Referer/UA 防盗链，SwMediaClient 拦截），
    // 否则（Electron smoke / 浏览器）直连；桌面主进程另有 swmedia:// 协议
    el.src = isNativeWebView() ? `/swmedia/?u=${encodeURIComponent(r.url)}` : r.url
    el.playbackRate = state().rate
    if (autoplay) await el.play()
    status = el.paused ? 'paused' : 'playing'
    updateMediaSession()
  } catch (e: any) {
    if (index !== i) return
    // 自动播放被系统策略阻止不是音源故障：换源/跳过都无意义，提示手动播放即可
    if (/notallowed|user didn|blocked/i.test(String(e?.message || ''))) {
      status = 'error'
      error = friendlyPlayError(e?.message) || '播放被系统阻止，请手动点击播放'
      emit('player:error', { message: error, song })
      publish()
      return
    }
    markSourceFailed(song)
    // 与桌面一致：同曲换源重试 MAX_RETRY 次后跳下一首，连续多首失败暂停提示
    if (retryCount < MAX_RETRY) {
      retryCount++
      void load(i, autoplay, true)
      return
    }
    failCurrent(song, friendlyPlayError(e?.message) || '播放失败')
  }
}

/** 记下坏链所属音源：重试时 resolveUrl 跳过它，真正换源而非重取同一条 */
function markSourceFailed(song: Song | null): void {
  for (const s of [song?.source, lastSource]) {
    if (s && !failedSources.includes(s)) failedSources.push(s)
  }
}

function failCurrent(song: Song | null, msg: string): void {
  retryCount = 0
  status = 'error'
  error = msg
  if (song) emit('player:error', { message: error, song })
  publish()
  if (!getSettings().skipOnError) return
  consecutiveFails++
  if (consecutiveFails >= 3) {
    emit('toast', { type: 'error', message: '连续多首播放失败，已暂停。请在设置中检查音源' })
    return
  }
  next(false)
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
el.addEventListener('playing', () => {
  status = 'playing'
  error = null
  retryCount = 0
  consecutiveFails = 0
  startTick()
  publish()
  updateMediaSession()
})
el.addEventListener('pause', () => { status = 'paused'; stopTick(); publish(); updateMediaSession() })
el.addEventListener('waiting', () => { status = 'loading'; publish() })
el.addEventListener('ratechange', () => publish())
el.addEventListener('volumechange', () => publish())
el.addEventListener('error', () => {
  if (!el.src) return
  const song = state().song
  markSourceFailed(song)
  if (retryCount < MAX_RETRY) {
    retryCount++
    void load(index, true, true)
    return
  }
  failCurrent(song, '音频加载失败，可能链接已失效')
})
el.addEventListener('ended', () => {
  const song = state().song
  if (song) addHistory(song, Math.round(position * 1000))
  stopTick()
  next(true)
})
el.addEventListener('timeupdate', tick)
el.addEventListener('progress', tick)

/* ---------------- MediaSession：锁屏 / 通知栏 / 蓝牙线控 ----------------
 * v2.3.1 新增系统能力：后台播放时锁屏出现「封面 + 标题 + 上/下/播控」，
 * 耳机线控与蓝牙按键同样生效（此前移动端完全没有系统集成，表现为
 * 「系统能力受限」）。WebView 的 MediaSession 由系统直接取 URL 拉封面，
 * 所以 artwork 用原始 pic 直链，而不是 /swmedia/ 代理路径。 */
function mediaSessionCover(): MediaImage[] {
  const song = queue[index]
  const pic = song?.pic || ''
  const url = /^https:\/\//i.test(pic)
    ? pic
    : /^http:\/\//i.test(pic) && !isNativeWebView()
      ? pic
      : ''
  return url ? [{ src: url, sizes: '512x512', type: 'image/jpeg' }] : []
}

function updateMediaSession(): void {
  const ms = (navigator as any).mediaSession
  if (!ms) return
  try {
    const song = queue[index]
    if (!song) {
      ms.metadata = null
      ms.playbackState = 'none'
      return
    }
    ms.metadata = new (window as any).MediaMetadata({
      title: song.name || '未命名',
      artist: song.singer || '未知歌手',
      album: song.album || '星河音乐',
      artwork: mediaSessionCover(),
    })
    ms.playbackState = el.paused ? 'paused' : 'playing'
  } catch { /* 老内核无 MediaMetadata，静默跳过 */ }
}

function installMediaSessionHandlers(): void {
  const ms = (navigator as any).mediaSession
  if (!ms || ms.__swInstalled) return
  try {
    ms.setActionHandler('play', () => { void el.play().catch(() => undefined) })
    ms.setActionHandler('pause', () => el.pause())
    ms.setActionHandler('previoustrack', () => prev())
    ms.setActionHandler('nexttrack', () => next(false))
    ms.setActionHandler('seekto', (d: any) => {
      if (d && typeof d.seekTime === 'number') {
        el.currentTime = Math.max(0, d.seekTime)
        position = el.currentTime
      }
    })
    ms.setActionHandler('stop', () => el.pause())
    ms.__swInstalled = true
  } catch { /* 个别 action 不支持时整组跳过 */ }
}
installMediaSessionHandlers()


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

  /* ---------------- 音效与频谱（规格书 v2.7 · 1.11 / 1.6） ---------------- */

  /** 写入 5 段 EQ 增益（dB，-12~12）。图按需建立：正在播放时立刻生效，否则等下次播放 */
  setEqBands(bands: number[]): void {
    eqBands = EQ_FREQS.map((_, i) => {
      const v = Number(bands?.[i])
      return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v))) : 0
    })
    if (audioCtx) {
      applyGains()
      return
    }
    if (!el.paused && ensureGraph()) applyGains()
  },

  /** 频谱订阅：返回取消函数。舞台视图可见时订阅，离开即退订（省电） */
  subscribeSpectrum(sink: (bars: number[]) => void): () => void {
    spectrumSinks.add(sink)
    startPump()
    return () => {
      spectrumSinks.delete(sink)
      if (!spectrumSinks.size) stopPump()
    }
  },
}

/* ---------------- Web Audio 图（移动端） ----------------
 * 移动端音频走同源 /swmedia 代理，因此可以安全建立 MediaElementSource，
 * 不会出现「跨域媒体被污染 → 输出静音」的问题。
 * 图只在用户真的开启音效/频谱时创建；创建失败则整体降级，不影响普通播放。
 */
const EQ_FREQS = [60, 230, 910, 3600, 14000]
let audioCtx: AudioContext | null = null
let eqFilters: BiquadFilterNode[] = []
let analyser: AnalyserNode | null = null
let eqBands: number[] = [0, 0, 0, 0, 0]
let graphBroken = false

function ensureGraph(): boolean {
  if (audioCtx) return true
  if (graphBroken) return false
  try {
    const Ctor: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctor) throw new Error('AudioContext 不可用')
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(el)
    eqFilters = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter()
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
      f.frequency.value = freq
      f.Q.value = 1
      f.gain.value = eqBands[i] || 0
      return f
    })
    const an = ctx.createAnalyser()
    an.fftSize = 256
    an.smoothingTimeConstant = 0.75
    let node: AudioNode = source
    for (const f of eqFilters) {
      node.connect(f)
      node = f
    }
    node.connect(an)
    an.connect(ctx.destination)
    audioCtx = ctx
    analyser = an
    void ctx.resume().catch(() => undefined)
    return true
  } catch {
    graphBroken = true
    return false
  }
}

type SpectrumSink = (bars: number[]) => void
const spectrumSinks = new Set<SpectrumSink>()
let spectrumTimer = 0

function applyGains(): void {
  if (!audioCtx) return
  eqFilters.forEach((f, i) => {
    // 平滑过渡，拖滑块时不爆音
    f.gain.setTargetAtTime(eqBands[i], audioCtx!.currentTime, 0.03)
  })
}

function pumpSpectrum(): void {
  if (!analyser || !spectrumSinks.size || el.paused) return
  const bins = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(bins)
  const n = 64
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i / n) ** 1.7 * bins.length)
    const to = Math.max(from + 1, Math.floor(((i + 1) / n) ** 1.7 * bins.length))
    let sum = 0
    for (let k = from; k < to && k < bins.length; k++) sum += bins[k]
    out.push(Math.round(sum / Math.max(1, to - from)))
  }
  for (const sink of spectrumSinks) {
    try {
      sink(out)
    } catch {
      /* 单个订阅者异常不影响其它 */
    }
  }
}

function startPump(): void {
  if (spectrumTimer) return
  if (!ensureGraph()) return
  spectrumTimer = window.setInterval(pumpSpectrum, 60)
}

function stopPump(): void {
  if (spectrumTimer) window.clearInterval(spectrumTimer)
  spectrumTimer = 0
}

// 移动端 AudioContext 常被自动播放策略挂起，恢复播放时必须显式 resume；
// 同时在这里按需建图（有已保存的 EQ 曲线或有人在听频谱时才建），
// 避免一启动就把 <audio> 接到挂起的 AudioContext 上导致「没声音」。
el.addEventListener('play', () => {
  if (!audioCtx && (spectrumSinks.size > 0 || eqBands.some(v => v !== 0))) {
    if (ensureGraph()) applyGains()
  }
  void audioCtx?.resume().catch(() => undefined)
})
