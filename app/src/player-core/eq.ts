/**
 * EQ 均衡器（规格书 v2.7 · 1.11）
 * ------------------------------------------------------------------
 * 6 预设 + 5 段滑块（60Hz / 230Hz / 910Hz / 3.6kHz / 14kHz，±12dB，步进 1dB）。
 * 真正的滤波在音频图里做：
 *   - 桌面：electron/player-host.ts 的 AudioContext（BiquadFilterNode 链），
 *     由 main.ts 注册的 IPC 后端下发增益；
 *   - 移动端：src/mobile/player.ts 的 AudioContext，同样 5 段链。
 * 本模块只负责「状态 + 持久化 + 广播给当前端后端」，不含任何 Web Audio 代码，
 * 因此可以被两端安全共用（不会把 Electron 依赖带进 WebView 包）。
 */
import { computed, ref } from 'vue'
import { lsGet, lsJson, lsSet, lsSetJson, platform } from '@/platform'

export const EQ_FREQS = [60, 230, 910, 3600, 14000] as const
export const EQ_MIN = -12
export const EQ_MAX = 12

export interface EqPreset {
  key: string
  label: string
  bands: number[]
}

/** 预设增益（dB），顺序与 EQ_FREQS 一致 */
export const EQ_PRESETS: EqPreset[] = [
  { key: 'off', label: '关闭', bands: [0, 0, 0, 0, 0] },
  { key: 'pop', label: '流行', bands: [1, 3, 2, 1, 0] },
  { key: 'rock', label: '摇滚', bands: [5, 3, -1, -2, 2] },
  { key: 'classical', label: '古典', bands: [3, 2, 0, 2, 4] },
  { key: 'vocal', label: '人声', bands: [-2, 1, 4, 3, -1] },
  { key: 'bass', label: '低音增强', bands: [7, 5, 1, 0, -1] },
]

/** 车机只保留 关闭 / 人声 / 低音增强（驾驶场景不做复杂调节） */
const CAR_PRESETS = ['off', 'vocal', 'bass']

export interface EqBackend {
  /** 把 5 段增益（dB）下发给音频图 */
  setBands(bands: number[]): void
}

let backend: EqBackend | null = null

function clampBand(v: number): number {
  const n = Math.round(Number(v) || 0)
  return Math.max(EQ_MIN, Math.min(EQ_MAX, n))
}

function normalizeBands(input: unknown): number[] {
  const arr = Array.isArray(input) ? input : []
  return EQ_FREQS.map((_, i) => clampBand(Number(arr[i]) || 0))
}

const presetKey = ref<string>(lsGet('eq_preset') || 'off')
const bands = ref<number[]>(normalizeBands(lsJson('eq_bands', [0, 0, 0, 0, 0])))

export const eqPreset = presetKey
export const eqBands = bands
export const eqPresets = computed(() =>
  platform.value.car ? EQ_PRESETS.filter(p => CAR_PRESETS.includes(p.key)) : EQ_PRESETS
)
export const eqEnabled = computed(() => bands.value.some(v => v !== 0))
export const eqCar = computed(() => platform.value.car)

export function pushEq(): void {
  backend?.setBands(bands.value)
}

export function registerEqBackend(b: EqBackend): void {
  backend = b
  // 后端就绪（音频图建立）后立刻应用上次保存的曲线，避免「设置里看着开了但没生效」
  pushEq()
}

export function applyEqPreset(key: string): void {
  const preset = EQ_PRESETS.find(p => p.key === key)
  if (!preset) return
  presetKey.value = key
  bands.value = [...preset.bands]
  lsSet('eq_preset', key)
  lsSetJson('eq_bands', bands.value)
  pushEq()
}

/** 手动拖滑块：实时改 filter.gain，预设标记转为 custom */
export function setEqBand(index: number, value: number): void {
  if (index < 0 || index >= EQ_FREQS.length) return
  const next = [...bands.value]
  next[index] = clampBand(value)
  bands.value = next
  presetKey.value = 'custom'
  lsSet('eq_preset', 'custom')
  lsSetJson('eq_bands', next)
  pushEq()
}

export function resetEq(): void {
  applyEqPreset('off')
}

export function currentBands(): number[] {
  return [...bands.value]
}
