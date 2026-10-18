import type { BrowserWindow } from 'electron'
import type { PlayMode, PlayerState, Song } from '../../shared/types'
import { createLogger } from './log'
import { resolveUrl } from './music-service'
import { addHistory, getSong, dbGetSetting, dbSetSetting } from './db'
import { getSettings } from './settings'

const logger = createLogger('player')

type Broadcast = (channel: string, payload: any) => void

interface HostMessage {
  type: string
  [k: string]: any
}

/**
 * 播放服务（主进程侧权威状态）。
 * 音频解码在独立的隐藏渲染进程（audio host）中完成，UI 进程崩溃不影响播放，
 * 反之音频流也不会阻塞 UI 渲染。
 */
class PlayerService {
  state: PlayerState = {
    status: 'idle',
    song: null,
    index: -1,
    position: 0,
    duration: 0,
    buffered: 0,
    volume: 0.8,
    muted: false,
    mode: 'repeat-all',
    quality: '320k',
    rate: 1,
    error: null,
    queue: [],
  }

  private host: BrowserWindow | null = null
  private hostReady = false
  private pendingLoad: any = null
  private loadToken = 0
  private failures = 0
  /** 连续「换源用尽后跳下一首」仍失败的歌曲数，播放成功即清零 */
  private consecutiveFails = 0
  private broadcast: Broadcast = () => {}
  private shuffleHistory: number[] = []
  private lastResolved: { url: string; quality: string; matched?: Song } | null = null
  private endedTimer: NodeJS.Timeout | null = null
  private sleepTimer: NodeJS.Timeout | null = null
  private sleepUntil = 0

  setBroadcast(fn: Broadcast): void {
    this.broadcast = fn
  }

  attachHost(win: BrowserWindow): void {
    this.host = win
    win.webContents.on('did-finish-load', () => {
      this.hostReady = true
      this.send({ type: 'config', volume: this.state.volume, fadeMs: getSettings().fadeMs })
      if (this.pendingLoad) {
        this.send(this.pendingLoad)
        this.pendingLoad = null
      }
    })
  }

  onHostMessage(msg: HostMessage): void {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'ready':
        this.hostReady = true
        break
      case 'state': {
        const st = String(msg.status || '')
        if (st === 'playing' || st === 'paused' || st === 'loading' || st === 'stopped') {
          this.state.status = st as PlayerState['status']
        }
        if (st === 'playing') this.consecutiveFails = 0
        if (typeof msg.duration === 'number' && msg.duration > 0) this.state.duration = msg.duration
        if (typeof msg.position === 'number') this.state.position = msg.position
        if (typeof msg.buffered === 'number') this.state.buffered = msg.buffered
        if (typeof msg.volume === 'number') this.state.volume = msg.volume
        this.emitTick()
        break
      }
      case 'ended':
        this.handleEnded()
        break
      case 'error':
        this.handlePlaybackError(String(msg.message || '音频加载失败'), Number(msg.code) || 0)
        break
      case 'log':
        logger.debug('host', msg.message)
        break
      default:
        break
    }
  }

  private emitTick(): void {
    this.broadcast('player:tick', {
      position: this.state.position,
      duration: this.state.duration,
      buffered: this.state.buffered,
      status: this.state.status,
    })
  }

  private emitState(): void {
    this.broadcast('player:state', {
      ...this.state,
      queue: this.state.queue,
    })
  }

  private send(msg: any): void {
    if (!this.host || this.host.isDestroyed()) return
    if (!this.hostReady) {
      this.pendingLoad = msg
      return
    }
    try {
      this.host.webContents.send('host:cmd', msg)
    } catch (e: any) {
      logger.warn('发送播放指令失败', e?.message)
    }
  }

  initFromSettings(): void {
    const s = getSettings()
    this.state.volume = s.volume
    this.state.mode = s.playMode
    this.state.quality = s.quality
    this.send({ type: 'config', volume: s.volume, fadeMs: s.fadeMs })
  }

  restoreSession(): void {
    const last = dbGetSetting<{ songId: string; position: number }>('player.last')
    if (!last?.songId) return
    const song = getSong(last.songId)
    if (!song) return
    this.state.song = song
    this.state.queue = [song]
    this.state.index = 0
    this.state.position = Math.max(0, Number(last.position) || 0)
    this.state.duration = song.duration || 0
    this.state.status = 'paused'
    this.emitState()
  }

  saveSession(): void {
    if (!this.state.song) return
    dbSetSetting('player.last', { songId: this.state.song.id, position: this.state.position })
  }

  setQueue(songs: Song[], startIndex = 0, autoplay = true): void {
    this.state.queue = [...songs]
    this.shuffleHistory = []
    this.emitState()
    if (songs.length) this.playAt(Math.max(0, Math.min(startIndex, songs.length - 1)), autoplay)
  }

  addToQueue(songs: Song[]): void {
    const exist = new Set(this.state.queue.map(s => s.id))
    const add = songs.filter(s => !exist.has(s.id))
    this.state.queue = [...this.state.queue, ...add]
    this.emitState()
  }

  addNext(song: Song): void {
    if (!this.state.song) {
      this.setQueue([song], 0, true)
      return
    }
    const idx = this.state.index
    const rest = this.state.queue.filter((s, i) => i !== idx && s.id !== song.id)
    const before = rest.slice(0, idx)
    const after = rest.slice(idx)
    this.state.queue = [...before, this.state.song, song, ...after]
    this.state.index = idx
    this.emitState()
    this.broadcast('toast', { type: 'success', message: '已设为下一首播放' })
  }

  removeAt(index: number): void {
    if (index < 0 || index >= this.state.queue.length) return
    const wasCurrent = index === this.state.index
    this.state.queue = this.state.queue.filter((_, i) => i !== index)
    if (index < this.state.index) this.state.index--
    if (wasCurrent) {
      if (this.state.queue.length === 0) {
        this.stop()
      } else {
        const nextIdx = Math.min(this.state.index, this.state.queue.length - 1)
        this.playAt(nextIdx, this.state.status === 'playing')
      }
    } else if (this.state.index >= this.state.queue.length) {
      this.state.index = this.state.queue.length - 1
    }
    this.emitState()
  }

  clearQueue(): void {
    this.stop()
    this.state.queue = []
    this.state.song = null
    this.state.index = -1
    this.emitState()
  }

  moveItem(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.state.queue.length || to >= this.state.queue.length) return
    const q = [...this.state.queue]
    const [item] = q.splice(from, 1)
    q.splice(to, 0, item)
    const cur = this.state.song
    this.state.queue = q
    this.state.index = cur ? q.findIndex(s => s.id === cur.id) : -1
    this.emitState()
  }

  async playAt(index: number, autoplay = true): Promise<void> {
    const song = this.state.queue[index]
    if (!song) return
    this.state.index = index
    this.state.song = song
    this.state.position = 0
    this.state.duration = song.duration || 0
    this.state.error = null
    this.state.status = 'loading'
    this.failures = 0
    this.emitState()
    await this.load(song, autoplay, 0)
  }

  private async load(song: Song, autoplay: boolean, startAt: number, retry = 0, avoid: string[] = []): Promise<void> {
    const token = ++this.loadToken
    const s = getSettings()
    try {
      const resolved = await resolveUrl(song, this.state.quality, s.autoSwitchSource, avoid)
      if (token !== this.loadToken) return
      this.lastResolved = resolved
      if (!song.pic && resolved.matched?.pic) {
        song.pic = resolved.matched.pic
      }
      if (!song.duration && resolved.matched?.duration) song.duration = resolved.matched.duration
      this.state.duration = song.duration || this.state.duration
      this.send({
        type: 'load',
        url: `swmedia://stream/?u=${encodeURIComponent(resolved.url)}`,
        autoplay: autoplay && s.autoPlay !== false,
        startAt,
        fadeMs: s.fadeMs,
        volume: this.state.volume,
        crossfadeMs: s.crossfade ? s.crossfadeMs : 0,
      })
      this.state.status = autoplay ? 'loading' : 'paused'
      this.emitState()
      if (resolved.matched) {
        logger.info(`已自动换源播放：${song.name} ← ${resolved.matched.source}`)
      }
    } catch (e: any) {
      if (token !== this.loadToken) return
      const msg = String(e?.message || e || '播放失败')
      if (retry < 1) {
        logger.warn('首次取链失败，重试一次', msg)
        setTimeout(() => this.load(song, autoplay, startAt, retry + 1), 500)
        return
      }
      this.handlePlaybackError(msg, 0)
    }
  }

  private handlePlaybackError(message: string, _code: number): void {
    this.state.status = 'error'
    this.state.error = message
    this.failures++
    this.emitState()
    this.broadcast('player:error', { message })
    logger.warn('播放失败', this.state.song?.name, message, `第 ${this.failures} 次`)

    const s = getSettings()
    const song = this.state.song
    if (!s.skipOnError) return

    // 同一首歌先尝试换源重试（最多 2 次），换源用尽仍失败就跳下一首
    if (song && this.failures <= 2) {
      const avoid = [song.source, this.lastResolved?.matched?.source || ''].filter(Boolean)
      setTimeout(() => {
        if (this.state.status === 'error') {
          logger.info('尝试换源重试', song.name, avoid.join(','))
          void this.load(song, true, this.state.position, 0, avoid)
        }
      }, 500)
      return
    }
    // 连续多首（换源用尽后逐首跳过仍失败）才判定音源整体故障而暂停
    this.consecutiveFails++
    if (this.consecutiveFails >= 3) {
      this.broadcast('toast', { type: 'error', message: '连续多首播放失败，已暂停。请在设置中检查音源' })
      return
    }
    setTimeout(() => {
      if (this.state.status === 'error') this.next(true, true)
    }, 700)
  }

  private handleEnded(): void {
    if (this.state.song) {
      addHistory(this.state.song, Math.round(this.state.duration * 1000))
    }
    const mode = this.state.mode
    if (mode === 'repeat-one') {
      this.state.position = 0
      this.seek(0)
      this.send({ type: 'play' })
      return
    }
    this.next(true)
  }

  async next(auto = false, skipFailed = false): Promise<void> {
    const q = this.state.queue
    if (!q.length) return
    const mode = this.state.mode
    let idx = this.state.index

    if (mode === 'shuffle' && !skipFailed) {
      if (q.length === 1) {
        this.playAt(0, true)
        return
      }
      let n = idx
      let guard = 0
      while (n === idx && guard++ < 30) n = Math.floor(Math.random() * q.length)
      this.shuffleHistory.push(idx)
      this.playAt(n, true)
      return
    }

    idx = idx + 1
    if (idx >= q.length) {
      if (mode === 'order' && auto) {
        this.state.status = 'stopped'
        this.state.position = 0
        this.emitState()
        return
      }
      idx = 0
    }
    this.playAt(idx, true)
  }

  prev(): void {
    const q = this.state.queue
    if (!q.length) return
    if (this.state.position > 4) {
      this.seek(0)
      return
    }
    let idx = this.state.index - 1
    if (this.state.mode === 'shuffle' && this.shuffleHistory.length) {
      idx = this.shuffleHistory.pop()!
    } else if (idx < 0) {
      idx = q.length - 1
    }
    this.playAt(idx, true)
  }

  toggle(): void {
    if (!this.state.song) {
      if (this.state.queue.length) this.playAt(0, true)
      return
    }
    if (this.state.status === 'playing') {
      this.send({ type: 'pause' })
      this.state.status = 'paused'
      this.emitState()
    } else if (this.state.status === 'error') {
      this.load(this.state.song, true, this.state.position)
    } else {
      if (this.state.status === 'idle' || this.state.status === 'stopped') {
        this.playAt(Math.max(0, this.state.index), true)
        return
      }
      this.send({ type: 'play' })
      this.state.status = 'playing'
      this.emitState()
    }
  }

  play(): void {
    if (this.state.status !== 'playing') this.toggle()
  }

  pause(): void {
    if (this.state.status === 'playing') {
      this.send({ type: 'pause' })
      this.state.status = 'paused'
      this.emitState()
    }
  }

  stop(): void {
    this.send({ type: 'stop' })
    this.state.status = 'stopped'
    this.state.position = 0
    this.emitState()
  }

  seek(seconds: number): void {
    const t = Math.max(0, Math.min(seconds, this.state.duration || seconds))
    this.state.position = t
    this.send({ type: 'seek', time: t })
    this.emitTick()
  }

  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, Number(v) || 0))
    this.state.volume = vol
    this.send({ type: 'volume', volume: vol })
    this.emitState()
  }

  setMuted(m: boolean): void {
    this.state.muted = m
    this.send({ type: 'mute', muted: m })
    this.emitState()
  }

  setMode(mode: PlayMode): void {
    this.state.mode = mode
    this.emitState()
  }

  setRate(rate: number): void {
    const r = Math.max(0.5, Math.min(2, Number(rate) || 1))
    this.state.rate = r
    this.send({ type: 'rate', rate: r })
    this.emitState()
  }

  /** 定时关闭：minutes <= 0 表示取消 */
  setSleepTimer(minutes: number): { until: number } {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer)
      this.sleepTimer = null
    }
    if (!minutes || minutes <= 0) {
      this.sleepUntil = 0
      this.broadcast('player:sleep', { until: 0 })
      return { until: 0 }
    }
    this.sleepUntil = Date.now() + minutes * 60 * 1000
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null
      this.sleepUntil = 0
      this.pause()
      this.broadcast('player:sleep', { until: 0 })
      this.broadcast('toast', { type: 'info', message: '定时关闭已生效，播放已暂停' })
    }, minutes * 60 * 1000)
    this.broadcast('player:sleep', { until: this.sleepUntil })
    return { until: this.sleepUntil }
  }

  getSleepUntil(): number {
    return this.sleepUntil
  }

  setQuality(q: string): void {
    if (this.state.quality === q) return
    this.state.quality = q
    this.emitState()
    if (this.state.song && this.state.status !== 'idle') {
      const pos = this.state.position
      this.load(this.state.song, this.state.status === 'playing', pos)
    }
  }

  getCurrent(): Song | null {
    return this.state.song
  }

  getState(): PlayerState {
    return { ...this.state }
  }

  dispose(): void {
    if (this.endedTimer) clearTimeout(this.endedTimer)
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.saveSession()
  }
}

export const player = new PlayerService()
