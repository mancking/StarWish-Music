/**
 * 移动端统一返回处理（v1.0.0 真机「手势直接退出应用」根因修复； 逐级返回）。
 *
 * Android 系统返回/手势返回在 MainActivity.onBackPressed 已统一转成 window 的
 * `backButton` 事件；边缘右滑返回手势（gestures.ts installEdgeBack）也汇入同一处理器，
 * 保证行为一致：
 *
 * 1. 输入框聚焦 → 先失焦（搜索页返回先关键盘，
 * 2. 视频播放页处于音频模式 → 先切回视频模式
 * 3. 播放队列/弹层打开 → 先关弹层（各 App 通用惯例；
 *   4. 路由栈可回退 → router.back() 逐级出栈
 * 5. 已在根路由 → 车机回推荐首页兜底；其余「再按一次退到后台」
 *      （保留后台播放，符合国内音乐 App 惯例；旧版行为是直接退出）
 *
 * 返回栈约定
 *   - 真实 push 入栈（from.matched.length>0），replace/redirect 不增加层级
 *   - 切 tab（/ /discover /mv /mine）视为新起点，清空旧栈
 *   - 弹栈用 router.back() 让浏览器/原生 history 逐级回退
 */
import type { Router } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { platform } from '@/platform'
import { closeTopPopup } from './popup-stack'

/** 只记录真实 push 的路径；replace/redirect 与 tab 切换不计入返回层级。 */
const appRouteStack: string[] = []
let trackedRouter: Router | null = null
/**
 * 导航类型队列。Vue Router 4 的 afterEach 回调只有 (to, from, failure)，
 * 没有 navigationType 参数，无法直接区分 push / replace（
 * replace 不增加返回层级），因此这里拦截 router.push / router.replace 记录类型。
 */
const navTypeQueue: ('push' | 'replace')[] = []
/** popAppRoute 触发回退后，afterEach 收到这次导航时用它消掉回写，
 * 防止「回退 → 把刚退出的页重新压栈 → 下次返回又回到这里」的死循环。
 * 用单值 token 而不是布尔：布尔在 router.back() 的 finally 里复位会早于
 * afterEach 触发（v1.0.0 旧代码的根因）。 */
let pendingBackTarget: string | null = null

/** 底栏 4 tab 的路由：切 tab 时返回栈重置为新 tab 的根页。 */
const TAB_ROOTS = new Set(['/', '/discover', '/mv', '/mine'])

/** 应当先失焦的输入元素 */
const FOCUSABLE_INPUT = ['INPUT', 'TEXTAREA']

/** 记录上一次返回时间，用于「双击退后台」 */
let lastBackAt = 0

function activeFocusable(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  if (FOCUSABLE_INPUT.includes(el.tagName)) return el
  if (el.isContentEditable) return el
  return null
}

/** 只把真实的应用内 push 记入栈；replace/redirect 与 tab 切换不增加返回层级。 */
export function trackAppRoute(router: Router): void {
  if (trackedRouter === router) return
  trackedRouter = router
  appRouteStack.length = 0
  // 拦截 router.push / router.replace 记录导航类型（Vue Router 4 的 afterEach
  // 只提供 (to, from, failure)，没有 navigationType 参数，必须自己记账）。
  const originalPush = router.push.bind(router)
  const originalReplace = router.replace.bind(router)
  router.push = ((...args: Parameters<Router['push']>) => {
    navTypeQueue.push('push')
    return originalPush(...args)
  }) as typeof router.push
  router.replace = ((...args: Parameters<Router['replace']>) => {
    navTypeQueue.push('replace')
    return originalReplace(...args)
  }) as typeof router.replace
  router.afterEach((to, from, failure) => {
    if (failure) return
    const navType = navTypeQueue.shift()
    // 这是一次 popAppRoute 触发的回退（replace 导航）：目标路径命中待消 token，
    // 消掉它，from（刚退出的页）不入栈。
    if (pendingBackTarget !== null && to.fullPath === pendingBackTarget) {
      pendingBackTarget = null
      return
    }
 // replace 不增加返回层级
    if (navType === 'replace') return
    if (to.fullPath === from.fullPath) return
    // 切 tab：旧栈作废，新 tab 成为返回起点
    if (TAB_ROOTS.has(to.path)) {
      appRouteStack.length = 0
      return
    }
    // 仅记录真实的 push：replace 不增加返回层级，根页入场（from.matched===0）也不记
    if (from.matched.length > 0) appRouteStack.push(from.fullPath)
  })
}

async function popAppRoute(router: Router): Promise<boolean> {
  const previous = appRouteStack.pop()
  if (previous === undefined) return false
  pendingBackTarget = previous
  // 用 router.replace 而非 router.back()：replace 返回 Promise，可 await 导航完成；
  // 且不污染浏览器/原生 history 栈（我们自己管返回栈）。
  try { await router.replace(previous) } catch {}
  return true
}

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

export async function handleBack(router: Router): Promise<void> {
  const player = usePlayerStore()
  const ui = useUiStore()

 // 0) 搜索页/任何输入框聚焦：先失焦，不操作路由
  const input = activeFocusable()
  if (input) {
    input.blur()
    return
  }

 // 1) 视频播放页在音频模式：先切回视频模式，再返回
  //    audioMode 由 MvPlayer/MvPlayer.vue 暴露到 window.__audioMode 供桥读取
  if ((window as any).__audioMode === true) {
    ;(window as any).__toggleAudioMode?.()
    return
  }

 // 2) 弹层优先关闭：页面弹层经 popup-stack 登记，返回键先关最上层
  if (player.queueOpen) {
    player.queueOpen = false
    return
  }
  if (ui.playlistPickerSong) {
    ui.playlistPickerSong = null
    return
  }
  if (closeTopPopup()) return

 // 3) 应用内栈逐级出栈
  if (await popAppRoute(router)) return

 // 4) 根页：车机先回推荐首页兜底（返回栈空不黑屏）；其余双击退后台
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
  trackAppRoute(router)
  window.addEventListener('backButton', () => {
    void handleBack(router)
  })
}
