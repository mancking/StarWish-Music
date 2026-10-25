/**
 * 频谱数据桥
 * ------------------------------------------------------------------
 * 数据源必须是真实的 AnalyserNode（fftSize=256），不允许用正弦假动画冒充：
 *   - 桌面：主进程音频宿主算好频段后事件回传（player:spectrum）；
 *   - 移动端：src/mobile/player.ts 的 AnalyserNode 直接 feedSpectrum。
 * 组件只读 spectrumBars，不关心数据来自哪一端。
 */
import { ref } from 'vue'
import { call, isDesktop, on as onEvent } from '@/api'

export const spectrumBars = ref<number[]>([])
export const spectrumActive = ref(false)

let bridgeReady = false

function ensureBridge(): void {
  if (bridgeReady || !isDesktop) return
  bridgeReady = true
  onEvent('player:spectrum', (data: unknown) => {
    if (Array.isArray(data)) spectrumBars.value = data as number[]
  })
}

/** 移动端本地分析器回填 */
export function feedSpectrum(data: number[]): void {
  spectrumBars.value = data
}

export function clearSpectrum(): void {
  spectrumBars.value = []
}

/**
 * 移动端数据源注册：移动端没有 IPC，由 main.mobile.ts 把本地 AnalyserNode
 * 的订阅接进来（on=true 开始分析，on=false 立即退订省电）。
 */
let localSource: ((on: boolean) => void) | null = null

export function registerLocalSpectrumSource(fn: (on: boolean) => void): void {
  localSource = fn
}

/** 打开/关闭订阅：只在舞台模式可见时开着，避免常驻 IPC 与 CPU 开销 */
export function setSpectrumActive(active: boolean): void {
  if (spectrumActive.value === active) return
  spectrumActive.value = active
  if (!isDesktop) {
    localSource?.(active)
    return
  }
  if (active) ensureBridge()
  void call('player:spectrum', { on: active }).catch(() => {
    /* 老版本主进程没有该通道：静默降级为静态柱 */
  })
}
