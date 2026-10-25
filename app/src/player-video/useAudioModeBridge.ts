/**
 * 音频模式桥接
 *
 * `back-handler` 与 `installEdgeBack` 位于播放器组件之外，无法直接读写组件的
 * `audioMode` ref；这里把当前页的音频模式状态与切换器挂在 `window.__audioMode` /
 * `window.__toggleAudioMode` 上，让统一的返回处理器可以逐级退出。
 */
import { onBeforeUnmount, watch, type Ref } from 'vue'

export interface AudioModeBridge {
  readonly mode: Ref<boolean>
  readonly exit: () => void
  readonly enter: () => void
}

/** 当前音频模式会话指针：back-handler（组件外）读取，无需响应式 */
let active: AudioModeBridge | null = null

export function useAudioModeBridge(
  audioMode: Ref<boolean>,
  enterAudioMode: () => void,
  exitAudioMode: () => void,
): void {
  active = { mode: audioMode, exit: exitAudioMode, enter: enterAudioMode }
  ;(window as any).__audioMode = audioMode
  ;(window as any).__toggleAudioMode = () => (audioMode.value ? exitAudioMode() : enterAudioMode())
  watch(audioMode, v => { (window as any).__audioMode = v })
  onBeforeUnmount(() => {
    ;(window as any).__audioMode = false
    ;(window as any).__toggleAudioMode = undefined
  })
}

export function currentAudioModeBridge(): AudioModeBridge | null {
  return (window as any).__audioMode === false ? null : active
}