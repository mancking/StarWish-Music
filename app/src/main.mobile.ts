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
import { installBackHandler } from './mobile/back-handler'
import { initPlatform } from './platform'
import { registerEqBackend } from './audio/eq'
import { feedSpectrum, registerLocalSpectrumSource } from './audio/spectrum'
import { player as mobileAudio } from './mobile/player'

async function bootstrap(): Promise<void> {
  // 平台感知：android / ios 分别注入（styles/platform.css 按此适配 HIG 细节，
  // 如 iOS Large Title 与 Android M3 触控节奏），不再写死 'android'
  const cap: any = (globalThis as any).Capacitor
  const osName = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : 'android'
  document.documentElement.dataset.platform = 'mobile'
  document.documentElement.dataset.os = osName === 'ios' ? 'ios' : 'android'
  // 规格书 v2.7 · 0.1 / 0.3 / 0.5：断点（手机/平板/车机）、性能档位、xinyuan_* 键
  initPlatform()
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
  const player = usePlayerStore(pinia)
  const library = useLibraryStore(pinia)
  // v2.3.1：先把界面挂上（页面自带骨架/加载态），仓库初始化在后台并行进行——
  // 不再让用户盯着 splash 等数据库/收藏/播放队列全部就绪。
  ;(window as any).__swStores = { player, library, ui }
  app.mount('#app')

  // 音效与频谱（规格书 v2.7 · 1.11 / 1.6）：WebView 里没有 IPC，
  // 直接把后端接到本地 <audio> 的 Web Audio 图（按需建图，不影响播放）。
  registerEqBackend({
    setBands: bands => mobileAudio.setEqBands(bands),
  })
  let spectrumUnsub: (() => void) | null = null
  registerLocalSpectrumSource(on => {
    if (on) {
      if (!spectrumUnsub) spectrumUnsub = mobileAudio.subscribeSpectrum(feedSpectrum)
    } else {
      spectrumUnsub?.()
      spectrumUnsub = null
    }
  })
  // 系统返回（含手势）：MainActivity 统一转 backButton 事件，这里接管
  // ——关弹层 → 回退 → 根页双击退后台，不再直接退出应用
  installBackHandler(router)
  void Promise.all([ui.init(), player.init(), library.init()])
    .catch(err => console.error('[renderer] 启动初始化失败', err))
    .finally(() => {
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('splash-out')
        setTimeout(() => splash.remove(), 450)
      }
    })
}

void bootstrap()
