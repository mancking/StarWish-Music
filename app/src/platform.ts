/**
 * 全端平台模型（规格书 v2.7 · 0.1 断点矩阵 / 0.3 性能分级 / 0.5 存储键）
 * ------------------------------------------------------------------
 * 唯一职责：把「当前是哪一端」和「该端允许的渲染档位」收敛成一份数据，
 * 播放页 / 视频页 / 粒子 / 频谱 / EQ 全部从这里取值，不再各自 matchMedia。
 *
 * 判定顺序（与规格书逐条对应）：
 *   ① 车机：UA 含 automotive / CarBrowser，或 URL ?platform=car，或本地配置
 *      xinyuan_car=1（车机配置项）→ 无视宽度走车机布局；
 *   ② 否则按 CSS 宽度：<600 手机 / 600~1024 平板 / ≥1024 桌面；
 *   ③ 平板 ≥900 宽视为横屏（两栏），由调用方读 landscape 决定。
 */
import { computed, ref } from 'vue'

export type PlatformKind = 'phone' | 'pad' | 'desktop' | 'car'

export interface PlatformTier {
  kind: PlatformKind
  /** 粒子数量：桌面 200 / 平板 80 / 手机 50 / 车机 0 */
  particles: number
  /** 封面模糊半径：桌面 30 / 平板 12 / 手机 0 / 车机 0 */
  blur: number
  /** 舞台频谱柱数：桌面 64 / 平板 32 / 手机 16 / 车机 0 */
  bars: number
  /** 唱片是否旋转：桌面 + 平板旋转，手机 / 车机静态 */
  rotate: boolean
  /** 粒子默认开启：桌面 / 平板开，手机默认关（需设置里手动开启） */
  particleDefault: boolean
  car: boolean
  touch: boolean
}

const PREFIX = 'xinyuan_'

/** 规格书 0.5：统一 xinyuan_ 前缀 */
export function lsGet(name: string): string | null {
  try {
    return localStorage.getItem(PREFIX + name)
  } catch {
    return null
  }
}

export function lsSet(name: string, value: string | number | boolean): void {
  try {
    localStorage.setItem(PREFIX + name, String(value))
  } catch {
    /* 隐私模式 / 配额满：状态不持久化，不影响本次使用 */
  }
}

export function lsJson<T>(name: string, fallback: T): T {
  const raw = lsGet(name)
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return (v ?? fallback) as T
  } catch {
    return fallback
  }
}

export function lsSetJson(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function isCarDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android Automotive|automotive|CarBrowser|Tesla|HMI\s*car/i.test(ua)) return true
  try {
    const q = new URLSearchParams(location.search)
    if (q.get('platform') === 'car') return true
  } catch {
    /* ignore */
  }
  return lsGet('car') === '1'
}

export function detectKind(width: number): PlatformKind {
  if (isCarDevice()) return 'car'
  if (width < 600) return 'phone'
  if (width < 1024) return 'pad'
  return 'desktop'
}

const winW = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const winH = ref(typeof window === 'undefined' ? 800 : window.innerHeight)

export const kindRef = ref<PlatformKind>(detectKind(winW.value))

export function tierFor(kind: PlatformKind): PlatformTier {
  switch (kind) {
    case 'car':
      return { kind, particles: 0, blur: 0, bars: 0, rotate: false, particleDefault: false, car: true, touch: true }
    case 'phone':
      return { kind, particles: 50, blur: 0, bars: 16, rotate: false, particleDefault: false, car: false, touch: true }
    case 'pad':
      return { kind, particles: 80, blur: 12, bars: 32, rotate: true, particleDefault: true, car: false, touch: true }
    default:
      return { kind, particles: 200, blur: 30, bars: 64, rotate: true, particleDefault: true, car: false, touch: false }
  }
}

export const platform = computed<PlatformTier>(() => tierFor(kindRef.value))
export const width = computed(() => winW.value)
export const height = computed(() => winH.value)
/** 平板横屏判定：规格书 0.1 ③ 平板 ≥900 宽走两栏 */
export const landscape = computed(() => winW.value >= 900 && winW.value >= winH.value)
export const isCar = computed(() => platform.value.car)
export const isPhone = computed(() => kindRef.value === 'phone')
export const isPad = computed(() => kindRef.value === 'pad')

/** 0.3：低性能设备 = 并发度 < 4 / 移动端 UA / 用户手动开启省电模式 */
export const lowPerf = computed(() => {
  const mode = lsGet('low_perf') || 'auto'
  if (mode === 'on') return true
  if (mode === 'off') return false
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 8
  return cores > 0 && cores < 4
})

/** 粒子是否生效：车机强制 0；手机需显式开启（xinyuan_particle_phone=1） */
export function particlesAllowed(): boolean {
  const tier = platform.value
  if (tier.particles <= 0) return false
  if (tier.kind === 'phone') return lsGet('particle_phone') === '1'
  return true
}

export function particleCount(): number {
  if (!particlesAllowed()) return 0
  const n = platform.value.particles
  return lowPerf.value ? Math.min(n, 80) : n
}

function applyDom(): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.kind = kindRef.value
  el.dataset.car = kindRef.value === 'car' ? '1' : '0'
  el.dataset.landscape = winW.value >= winH.value ? '1' : '0'
  // 规格书 0.5：启动写入端类型
  lsSet('platform', kindRef.value)
}

/** 启动时调用一次；重复调用幂等 */
export function initPlatform(): void {
  if (typeof window === 'undefined') return
  const recalc = (): void => {
    winW.value = window.innerWidth
    winH.value = window.innerHeight
    const next = detectKind(winW.value)
    if (next !== kindRef.value) kindRef.value = next
    applyDom()
  }
  window.addEventListener('resize', recalc, { passive: true })
  window.addEventListener('orientationchange', recalc, { passive: true })
  recalc()
}

/** 组件内统一入口 */
export function usePlatform() {
  return {
    platform,
    kind: kindRef,
    width,
    height,
    landscape,
    isCar,
    isPhone,
    isPad,
    lowPerf,
    particles: computed(() => particleCount()),
  }
}
