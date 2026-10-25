import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useUiStore } from './stores/ui'
import { usePlayerStore } from './stores/player'
import { useLibraryStore } from './stores/library'
import { initPlatform } from './platform'
import { registerEqBackend } from './player-core/eq'
import { call } from './api'
import './styles/main.css'
import './styles/car.css'

// 设计 token 按端切换：桌面用紧凑尺寸，移动端用大圆角/大行高。
// data-os 细分操作系统（styles/platform.css 按此适配各端 HIG 细节）：
// 红绿灯避让（darwin）、Segoe UI（win32）、Cantarell（linux）。
const os = /Mac|iP(hone|ad|od)/.test(navigator.userAgent)
  ? 'darwin'
  : /Win/.test(navigator.userAgent)
    ? 'win32'
    : 'linux'
document.documentElement.dataset.platform = 'desktop'
document.documentElement.dataset.os = os
//四端断点、性能档位、xinyuan_* 键统一入口
initPlatform()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

app.config.errorHandler = (err, _instance, info) => {
  console.error('[renderer] 组件异常', err, info)
  try {
    const ui = useUiStore(pinia)
    ui.toast(`界面出现异常：${(err as any)?.message || err}`, 'error', 5000)
  } catch {
    /* pinia 尚未就绪 */
  }
}

window.addEventListener('error', e => {
  console.error('[renderer] 未捕获错误', e.error || e.message)
})
window.addEventListener('unhandledrejection', e => {
  console.error('[renderer] 未处理 Promise', e.reason)
  e.preventDefault()
})

/**
 * 启动流程（v1.0.0 优化）：
 * 旧实现先 await 三个 store 的 init（含全量本地曲库扫描 + 历史读取）才 mount，
 * 导致首帧被推迟数秒到十余秒，窗口长时间空白。
 * 现在：先 mount 出界面骨架（splash 覆盖其上），再并行拉取数据，
 * 数据就绪后淡出 splash。用户感知的启动时间从「等窗口出现」变成「立即出现」。
 */
async function bootstrap(): Promise<void> {
  const ui = useUiStore(pinia)
  const player = usePlayerStore(pinia)
  const library = useLibraryStore(pinia)

  // 先挂载：界面骨架立刻可见
  app.mount('#app')
  ;(window as any).__swStores = { player, library, ui }

 // 音效 ：状态与预设在本进程，滤波在隐藏音频宿主的
  // AudioContext 里做；宿主未就绪时主进程会排队补发，不会丢曲线。
  registerEqBackend({
    setBands: bands => {
      void call('player:eq', { bands }).catch(() => {})
    },
  })

  const splash = document.getElementById('splash')
  const hideSplash = (): void => {
    if (!splash || splash.classList.contains('splash-out')) return
    splash.classList.add('splash-out')
    setTimeout(() => splash.remove(), 450)
  }

 //splash 8s 超时兜底（任一 init 挂起时强制淡出，不永驻）
 // Bug C：splash 超时兜底从 8s 降到 3s
  // 旧实现从 bootstrap 开头起算，ui 慢时 splash 早逝、界面白屏）
  const splashGuard = window.setTimeout(hideSplash, 3000)

  // 设置最优先（决定主题），其余并行；任何一个失败都不阻塞界面
  await ui.init().catch(() => {})

 //首次启动引导（onboarded=false → /welcome 三屏）
  if ((ui.settings as any).onboarded === false && router.currentRoute.value.path !== '/welcome') {
    void router.replace('/welcome')
  }

 //播放器/曲库就绪后再撤 splash，避免露出空骨架
  void Promise.allSettled([player.init(), library.init()]).then(() => {
    window.clearTimeout(splashGuard)
    hideSplash()
    // 便于自动化冒烟测试读取状态（不参与业务逻辑）
    ;(window as any).__swStores = { player, library, ui }
  })
}

void bootstrap()
