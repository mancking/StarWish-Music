import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useUiStore } from './stores/ui'
import { usePlayerStore } from './stores/player'
import { useLibraryStore } from './stores/library'
import './styles/main.css'

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

async function bootstrap(): Promise<void> {
  const ui = useUiStore(pinia)
  await ui.init()
  const player = usePlayerStore(pinia)
  const library = useLibraryStore(pinia)
  await Promise.all([player.init(), library.init()])
  // 便于自动化冒烟测试读取状态（不参与业务逻辑）
  ;(window as any).__swStores = { player, library, ui }
  app.mount('#app')
}

void bootstrap()
