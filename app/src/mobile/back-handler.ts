/**
 * 移动端统一返回处理（v2.3.2 真机「手势直接退出应用」根因修复）。
 *
 * Android 系统返回/手势返回在 MainActivity 已统一转成 window 的
 * `backButton` 事件；边缘右滑返回手势也汇入同一处理器，保证行为一致：
 *
 *   1. 播放队列/弹层打开 → 先关弹层（各 App 通用惯例）
 *   2. 路由栈可回退 → router.back()
 *   3. 已在根路由 → 「再按一次退到后台」双击确认，退后台不杀进程
 *      （保留后台播放，符合国内音乐 App 惯例；旧版行为是直接退出）
 */
import type { Router } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { platform } from '@/platform'
import { closeTopPopup } from './popup-stack'

let lastBackAt = 0

function nativeCall(plugin: string, method: string, opts?: any): Promise<any> {
  const cap: any = (globalThis as any).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') return Promise.reject(new Error('原生通道不可用'))
  return cap.nativePromise(plugin, method, opts ?? {})
}

function minimizeApp(): void {
  nativeCall('SwBridge', 'moveTaskToBack').catch(() => {
    /* 冒烟环境无原生层：忽略 */
  })
}

export function handleBack(router: Router): void {
  const player = usePlayerStore()
  const ui = useUiStore()

  // 1) 弹层优先关闭（Bug 39）：页面弹层经 popup-stack 登记，返回键先关最上层
  if (player.queueOpen) {
    player.queueOpen = false
    return
  }
  if (ui.playlistPickerSong) {
    ui.playlistPickerSong = null
    return
  }
  if (closeTopPopup()) return

  // 2) 全屏路由（播放页等）：直接回栈
  // 3) 路由栈可回退 → 回退
  const state = router.options.history.state
  if (state && state.back != null) {
    router.back()
    return
  }

  // 4) 根页：车机先回推荐首页兜底（Bug 70：返回栈空不黑屏）；其余双击退后台
  if (platform.value.kind === 'car') {
    if (router.currentRoute.value.path !== '/') {
      void router.replace('/')
      return
    }
    minimizeApp()
    return
  }
  const now = Date.now()
  if (now - lastBackAt < 2200) {
    minimizeApp()
    lastBackAt = 0
  } else {
    lastBackAt = now
    ui.toast('再按一次返回键退到后台', 'info', 2000)
  }
}

/** 安装系统 backButton 事件监听（MainActivity 转发的事件挂在 window 上） */
export function installBackHandler(router: Router): void {
  window.addEventListener('backButton', () => handleBack(router))
}
