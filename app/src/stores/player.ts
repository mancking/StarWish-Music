import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LyricResult, PlayMode, PlayerState, Song } from '@shared/types'
import { call, on } from '@/api'
import { extractAccent } from '@/utils/color'
import { lsGet, lsSet, platform } from '@/platform'
import { useUiStore } from './ui'

/**
 * 播放页页面态
 * 页面级双切换只有两页：cover 封面页 / lyrics 歌词页（左右滑切换）。
 * 旧的「粒子/舞台」视觉模式已并入播放页背景 settings.playerBg
 * （cover/lyric-wall/particle/spectrum，，不再作为页面态。
 * 旧版本 xinyuan_visual_mode 存 particle/stage 的，映射回 cover。
 */
export type StageMode = 'cover' | 'lyrics'

const STAGE_LEGACY: Record<string, StageMode> = {
  cover: 'cover',
  lyrics: 'lyrics',
  particle: 'cover',
  stage: 'cover',
  cinema: 'cover',
  podcast: 'cover',
}

function readStage(): StageMode {
  let raw = lsGet('visual_mode')
  if (!raw) {
    try {
      raw = localStorage.getItem('sw.stage')
    } catch {
      raw = null
    }
  }
  return (raw && STAGE_LEGACY[raw]) || 'cover'
}

function readLoopMode(): PlayMode | null {
  const raw = lsGet('loop_mode')
  return raw === 'repeat-all' || raw === 'repeat-one' || raw === 'shuffle' || raw === 'order' ? raw : null
}

const EMPTY: PlayerState = {
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

export const usePlayerStore = defineStore('player', () => {
  const ui = useUiStore()
  const state = ref<PlayerState>({ ...EMPTY })
  const displayPosition = ref(0)
  const lyric = ref<LyricResult | null>(null)
  const lyricLoading = ref(false)
  const queueOpen = ref(false)
  const stage = ref<StageMode>(readStage())
  const initialized = ref(false)
  const coverUrl = ref('')
  const sleepUntil = ref(0)

  let basePos = 0
  let baseAt = performance.now()
  let raf = 0
  let lyricToken = 0
 /**无歌词歌曲的负缓存（key → 时间戳） */
  const lyricNegative = new Map<string, number>()
  let lastSongId = ''
  let lastAccentSrc = ''

  const playing = computed(() => state.value.status === 'playing')
  const song = computed(() => state.value.song)
  const duration = computed(() => state.value.duration || state.value.song?.duration || 0)
  const progress = computed(() => (duration.value ? displayPosition.value / duration.value : 0))
  const modeLabel = computed(() => {
    const m = state.value.mode
    return m === 'repeat-one' ? '单曲循环' : m === 'repeat-all' ? '列表循环' : m === 'shuffle' ? '随机播放' : '顺序播放'
  })

  function tick(): void {
    if (!playing.value) {
      raf = 0
      return
    }
    const elapsed = (performance.now() - baseAt) / 1000
    displayPosition.value = Math.min(duration.value || 0, basePos + elapsed)
    raf = requestAnimationFrame(tick)
  }

  function startTick(): void {
    if (raf) return
    raf = requestAnimationFrame(tick)
  }

  function syncPosition(pos: number, dur?: number): void {
    basePos = Math.max(0, pos || 0)
    baseAt = performance.now()
    displayPosition.value = basePos
    if (dur && dur > 0) state.value.duration = dur
  }

  async function init(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    try {
      const s = await call<PlayerState>('player:state')
      applyState(s, true)
 //音量持久化恢复（settings.playerVolume 0~100）
      const savedVol = Number((ui.settings as any).playerVolume)
      if (Number.isFinite(savedVol) && savedVol >= 0 && Math.abs(s?.volume - savedVol / 100) > 0.02) {
        state.value.volume = Math.min(1, Math.max(0, savedVol / 100))
        void call('player:volume', { volume: state.value.volume }).catch(() => undefined)
      }
 //循环模式持久化（xinyuan_loop_mode），重启后恢复
      const savedLoop = readLoopMode()
      if (savedLoop && s?.mode !== savedLoop) void setMode(savedLoop)
    } catch (e: any) {
      ui.toast(`播放器初始化失败：${e.message}`, 'error')
    }

    on('player:state', (s: PlayerState) => applyState(s))
    on('player:tick', (t: any) => {
      if (typeof t.duration === 'number' && t.duration > 0) state.value.duration = t.duration
      if (typeof t.buffered === 'number') state.value.buffered = t.buffered
      if (typeof t.status === 'string') state.value.status = t.status
      syncPosition(Number(t.position) || 0)
    })
    on('player:sleep', (p: any) => {
      sleepUntil.value = Number(p?.until) || 0
    })
    on('player:error', (e: any) => {
      if (e?.message) ui.toast(e.message, 'error', 4200)
    })
  }

  function applyState(s: PlayerState, force = false): void {
    if (!s) return
    const prevId = state.value.song?.id
    state.value = { ...state.value, ...s, queue: s.queue || state.value.queue }
    if (s.song?.id !== prevId || force) {
      state.value.position = s.position || 0
      syncPosition(s.position || 0, s.duration)
    } else if (Math.abs((s.position || 0) - displayPosition.value) > 1.2) {
      syncPosition(s.position || 0)
    }
    if (s.song) void onSongChanged()
    if (s.status === 'playing') startTick()
  }

  async function onSongChanged(): Promise<void> {
    const s = state.value.song
    if (!s) {
      lyric.value = null
      coverUrl.value = ''
      lastSongId = ''
      return
    }
    const same = s.id === lastSongId
    // 同一首歌：歌词已就绪或正在加载则不重复请求；上次失败则允许重试
    if (same && (lyricLoading.value || (lyric.value && lyric.value.lines.length))) return
    lastSongId = s.id
    lyric.value = null
    lyricLoading.value = true
    const token = ++lyricToken

    // 封面：优先使用歌曲自带（已转协议），否则向主进程请求多级回退
    coverUrl.value = s.pic || ''
    if (!coverUrl.value) {
      try {
        const url = await call<string>('music:cover', { song: s })
        if (token === lyricToken && url) coverUrl.value = url
      } catch {
        /* 封面失败不影响播放 */
      }
    }
    if (coverUrl.value && coverUrl.value !== lastAccentSrc) {
      lastAccentSrc = coverUrl.value
      // 取色是纯装饰，不能阻塞歌词加载
      void extractAccent(coverUrl.value).then(color => {
        if (color && token === lyricToken) ui.setDynamicAccent(color)
      })
    }

    try {
 //空歌词负缓存（30 分钟内同一首不再重复 IPC）
      const key = `${s.source}:${s.songId || s.id}`
      const negAt = lyricNegative.get(key)
      if (negAt && Date.now() - negAt < 30 * 60_000) {
        if (token === lyricToken) lyricLoading.value = false
        return
      }
      const res = await call<LyricResult>('music:lyric', { song: s })
      if (token === lyricToken) lyric.value = res
      if (res && !res.lines.length) lyricNegative.set(key, Date.now())
    } catch {
      if (token === lyricToken) lyric.value = null
    } finally {
      if (token === lyricToken) lyricLoading.value = false
    }
  }

  /** 手动重新匹配歌词（播放页「重新匹配」按钮） */
  async function reloadLyric(): Promise<void> {
    const s = state.value.song
    if (!s) return
    lastSongId = ''
    lyric.value = null
    await onSongChanged()
  }

  async function playSongs(songs: Song[], index = 0): Promise<void> {
    if (!songs.length) return
    try {
      const s = await call<PlayerState>('player:playList', { songs, index })
      applyState(s, true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function playSong(target: Song, list?: Song[], index?: number): Promise<void> {
    try {
      const s = await call<PlayerState>('player:playNow', { song: target, songs: list, index })
      applyState(s, true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function playAt(index: number): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:playAt', { index }), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function toggle(): Promise<void> {
    try {
      const s = await call<PlayerState>('player:toggle')
      applyState(s, true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function next(): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:next'), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function prev(): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:prev'), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function seekTo(sec: number): Promise<void> {
    syncPosition(sec)
    try {
      await call('player:seek', { time: sec })
    } catch {
      /* 静默失败，下一次 tick 会校正 */
    }
  }

  async function setVolume(v: number): Promise<void> {
    const nv = Math.max(0, Math.min(1, v))
    state.value.volume = nv
 //拖音量滑条即解除静音（否则静音下拖动永远无声）
    if (nv > 0 && state.value.muted) {
      state.value.muted = false
      try {
        await call('player:mute', { muted: false })
      } catch {
        /* ignore */
      }
    }
    try {
      await call('player:volume', { volume: nv })
 // 音量持久化：跨页/重启不再回到默认值
      void ui.patch({ playerVolume: Math.round(nv * 100) })
    } catch {
      /* ignore */
    }
  }

  async function toggleMute(): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:mute', { muted: !state.value.muted }), true)
    } catch {
      /* ignore */
    }
  }

  async function cycleMode(): Promise<void> {
 //列表 → 单曲 → 随机 → 关闭；车机只保留两态
    const order: PlayMode[] = platform.value.car
      ? ['repeat-all', 'repeat-one']
      : ['repeat-all', 'repeat-one', 'shuffle', 'order']
    const idx = order.indexOf(state.value.mode)
    const nextMode = order[(idx + 1) % order.length]
    try {
      applyState(await call<PlayerState>('player:mode', { mode: nextMode }), true)
      lsSet('loop_mode', nextMode)
      ui.toast(
        nextMode === 'repeat-one' ? '单曲循环' : nextMode === 'repeat-all' ? '列表循环' : nextMode === 'shuffle' ? '随机播放' : '关闭循环',
        'info',
        1400
      )
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function setMode(mode: PlayMode): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:mode', { mode }), true)
      lsSet('loop_mode', mode)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function setRate(rate: number): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:rate', { rate }), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function cycleRate(): Promise<void> {
    const list = [1, 1.25, 1.5, 0.75]
    const cur = state.value.rate || 1
    const next = list[(list.indexOf(cur) + 1) % list.length]
    await setRate(next)
    ui.toast(`播放速度 ${next}×`, 'info', 1400)
  }

  async function setSleep(minutes: number): Promise<void> {
    try {
      const r = await call<{ until: number }>('player:sleep', { minutes })
      sleepUntil.value = r.until
      if (r.until) {
        const m = Math.round((r.until - Date.now()) / 60000)
        ui.toast(`已设置 ${m} 分钟后停止播放`, 'success', 2000)
      } else {
        ui.toast('已取消定时关闭', 'info', 1600)
      }
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function setQuality(q: string): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:quality', { quality: q }), true)
      ui.toast(`已切换音质：${q === 'flac24bit' ? 'Hi-Res' : q === 'flac' ? '无损' : q === '320k' ? '320K' : '128K'}`, 'success', 1600)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function addNext(s: Song): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:addNext', { song: s }), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function addToQueue(list: Song[]): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:addQueue', { songs: list }), true)
      ui.toast(`已添加 ${list.length} 首到播放队列`, 'success', 1600)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function removeAt(index: number): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:removeAt', { index }), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function move(from: number, to: number): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:move', { from, to }), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  async function clearQueue(): Promise<void> {
    try {
      applyState(await call<PlayerState>('player:clear'), true)
    } catch (e: any) {
      ui.toast(e.message, 'error')
    }
  }

  function setStage(s: StageMode): void {
    stage.value = s
    lsSet('visual_mode', s)
    try {
      localStorage.removeItem('sw.stage')
    } catch {
      /* ignore */
    }
  }



  watch(
    () => state.value.status,
    st => {
      if (st === 'playing') {
        baseAt = performance.now()
        startTick()
      }
    }
  )

  return {
    state,
    song,
    playing,
    duration,
    displayPosition,
    progress,
    lyric,
    lyricLoading,
    queueOpen,
    stage,
    modeLabel,
    coverUrl,
    init,
    applyState,
    playSongs,
    playSong,
    playAt,
    toggle,
    next,
    prev,
    seekTo,
    setVolume,
    toggleMute,
    cycleMode,
    setMode,
    setQuality,
    addNext,
    addToQueue,
    removeAt,
    move,
    clearQueue,
    setStage,
    reloadLyric,
    sleepUntil,
    setRate,
    cycleRate,
    setSleep,
  }
})
