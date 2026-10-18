/**
 * 移动端打包入口（Android / iOS WebView）。
 *
 * 与桌面 `src/main.ts` 的唯一差别：在创建 Vue app 之前装好 `window.sw`
 * ——桌面由 Electron preload 注入，WebView 里必须由本桥提供，否则 renderer
 * 一调用 `call()` 就崩（白屏）。
 *
 * 桥的实现见 `./mobile/bridge`（真 audio 播放器 + 虚拟 fs + 原生 fs 的
 * core 复用 + IndexedDB 持久化）。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useUiStore } from './stores/ui'
import { usePlayerStore } from './stores/player'
import { useLibraryStore } from './stores/library'
import './styles/main.css'
import './styles/mobile.css'
import { installBridge } from './mobile/bridge'
import { installPullRefresh } from './mobile/pull-refresh'

async function bootstrap(): Promise<void> {
  await installBridge()
  installPullRefresh()

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

  const ui = useUiStore(pinia)
  await ui.init()
  const player = usePlayerStore(pinia)
  const library = useLibraryStore(pinia)
  await Promise.all([player.init(), library.init()])
  ;(window as any).__swStores = { player, library, ui }
  app.mount('#app')
}

void bootstrap()
