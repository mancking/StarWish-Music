/**
 * 音频宿主（独立渲染进程）：只负责解码与播放，不做任何 UI 渲染。
 * 与主进程通过 IPC 通信，崩溃/卡顿都不会影响主界面。
 */

interface HostApi {
  onCommand(cb: (cmd: any) => void): () => void
  report(msg: any): void
}

const api = (window as any).audioHost as HostApi

const audio = new Audio()
audio.preload = 'auto'
audio.crossOrigin = 'anonymous'

let targetVolume = 0.8
let muted = false
let fadeMs = 400
let currentUrl = ''
let pendingSeek: number | null = null
let reportedError = ''
let watchdog: number | null = null
let lastProgressAt = Date.now()
let lastPosition = 0
let tickTimer: number | null = null
let loadingSince = 0

function report(msg: any): void {
  try {
    api.report(msg)
  } catch {
    /* ignore */
  }
}

function state(status?: string): void {
  const pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0
  let buffered = 0
  try {
    if (audio.buffered.length) buffered = audio.buffered.end(audio.buffered.length - 1)
  } catch {
    buffered = 0
  }
  report({
    type: 'state',
    status: status || (audio.paused ? 'paused' : 'playing'),
    position: pos,
    duration: dur,
    buffered,
    volume: audio.volume,
  })
}

function errorMessage(code: number): string {
  switch (code) {
    case 1:
      return '播放被中止'
    case 2:
      return '网络错误，音频流中断'
    case 3:
      return '音频解码失败（格式可能不受支持）'
    case 4:
      return '音频地址不可用或格式不支持'
    default:
      return '音频加载失败'
  }
}

function fadeTo(target: number, duration: number, done?: () => void): void {
  const from = audio.volume
  const to = Math.max(0, Math.min(1, target))
  if (!duration || duration <= 0 || Math.abs(from - to) < 0.01) {
    audio.volume = to
    done?.()
    return
  }
  const start = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / duration)
    audio.volume = from + (to - from) * t
    if (t < 1) requestAnimationFrame(step)
    else done?.()
  }
  requestAnimationFrame(step)
}

function clearWatchdog(): void {
  if (watchdog !== null) {
    window.clearInterval(watchdog)
    watchdog = null
  }
}

function startWatchdog(): void {
  clearWatchdog()
  lastProgressAt = Date.now()
  lastPosition = audio.currentTime
  watchdog = window.setInterval(() => {
    if (audio.paused) return
    const pos = audio.currentTime
    if (Math.abs(pos - lastPosition) > 0.05) {
      lastPosition = pos
      lastProgressAt = Date.now()
      return
    }
    // 位置长时间不动且缓冲不足 → 判定卡死
    if (Date.now() - lastProgressAt > 25000 && audio.readyState < 3) {
      report({ type: 'error', message: '音频加载超时（网络或音源不可用）', code: 2 })
      lastProgressAt = Date.now()
    }
  }, 3000)
}

function startTicker(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(() => {
    if (!audio.paused) state('playing')
  }, 500)
}

function attachEvents(): void {
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      try {
        audio.currentTime = Math.max(0, Math.min(pendingSeek, audio.duration || pendingSeek))
      } catch {
        /* ignore */
      }
      pendingSeek = null
    }
    state(audio.paused ? 'paused' : 'playing')
  })
  audio.addEventListener('canplay', () => {
    if (loadingSince && Date.now() - loadingSince < 60000) loadingSince = 0
    state(audio.paused ? 'paused' : 'playing')
  })
  audio.addEventListener('playing', () => {
    reportedError = ''
    startWatchdog()
    startTicker()
    state('playing')
  })
  audio.addEventListener('pause', () => state('paused'))
  audio.addEventListener('waiting', () => state('loading'))
  audio.addEventListener('ended', () => {
    report({ type: 'ended' })
    state('stopped')
  })
  audio.addEventListener('error', () => {
    const code = audio.error?.code || 0
    const msg = errorMessage(code)
    const key = `${currentUrl}|${code}`
    if (reportedError === key) return
    reportedError = key
    report({ type: 'error', message: msg, code })
  })
  audio.addEventListener('timeupdate', () => {
    if (audio.currentTime > 0) loadingSince = 0
  })
}

async function load(cmd: any): Promise<void> {
  const url = String(cmd.url || '')
  if (!url) return
  clearWatchdog()
  currentUrl = url
  reportedError = ''
  const autoplay = cmd.autoplay !== false
  const fade = Number(cmd.fadeMs ?? fadeMs) || 0
  if (typeof cmd.volume === 'number') targetVolume = Math.max(0, Math.min(1, cmd.volume))

  if (audio.src && !audio.paused && fade > 0) {
    await new Promise<void>(resolve => fadeTo(0, Math.min(500, fade), () => resolve()))
  }
  audio.pause()
  audio.src = url
  audio.playbackRate = Math.max(0.5, Math.min(2, Number(cmd.rate) || 1))
  audio.muted = muted
  audio.volume = 0
  pendingSeek = Number(cmd.startAt) > 0 ? Number(cmd.startAt) : null
  loadingSince = Date.now()
  state('loading')
  try {
    audio.load()
  } catch {
    /* ignore */
  }
  if (autoplay) {
    try {
      await audio.play()
      fadeTo(muted ? 0 : targetVolume, fade)
      state('playing')
    } catch (e: any) {
      if (String(e?.name) === 'AbortError') return
      report({ type: 'error', message: `播放启动失败：${e?.message || e}`, code: 0 })
    }
  } else {
    audio.volume = muted ? 0 : targetVolume
  }
}

function handle(cmd: any): void {
  if (!cmd || typeof cmd !== 'object') return
  switch (cmd.type) {
    case 'load':
      void load(cmd)
      break
    case 'play':
      audio
        .play()
        .then(() => {
          fadeTo(muted ? 0 : targetVolume, fadeMs)
          state('playing')
        })
        .catch((e: any) => {
          if (String(e?.name) === 'NotAllowedError') {
            report({ type: 'error', message: '播放被系统阻止，请重试', code: 0 })
          } else if (String(e?.name) !== 'AbortError') {
            report({ type: 'error', message: `播放失败：${e?.message || e}`, code: 0 })
          }
        })
      break
    case 'pause':
      fadeTo(0, Math.min(200, fadeMs), () => {
        audio.pause()
        audio.volume = muted ? 0 : targetVolume
        state('paused')
      })
      break
    case 'stop':
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      currentUrl = ''
      state('stopped')
      break
    case 'seek': {
      const t = Number(cmd.time) || 0
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = t
          state(audio.paused ? 'paused' : 'playing')
        } catch {
          pendingSeek = t
        }
      } else {
        pendingSeek = t
      }
      break
    }
    case 'volume': {
      targetVolume = Math.max(0, Math.min(1, Number(cmd.volume) || 0))
      if (!muted) fadeTo(targetVolume, 80)
      state(audio.paused ? 'paused' : 'playing')
      break
    }
    case 'mute':
      muted = !!cmd.muted
      audio.muted = muted
      state(audio.paused ? 'paused' : 'playing')
      break
    case 'rate':
      audio.playbackRate = Math.max(0.5, Math.min(2, Number(cmd.rate) || 1))
      break
    case 'config':
      if (typeof cmd.volume === 'number') targetVolume = Math.max(0, Math.min(1, cmd.volume))
      if (typeof cmd.fadeMs === 'number') fadeMs = cmd.fadeMs
      audio.volume = muted ? 0 : targetVolume
      break
    default:
      break
  }
}

attachEvents()
api.onCommand(handle)
startTicker()
report({ type: 'ready' })
