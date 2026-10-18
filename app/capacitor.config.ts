import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android / iOS 外壳（Capacitor）。
 * webDir 指向 src 的浏览器构建产物；桌面 Electron 构建不受影响。
 */
const config: CapacitorConfig = {
  appId: 'com.starwish.music',
  appName: '星河音乐',
  webDir: 'dist/mobile',
  android: {
    allowMixedContent: true,
    // 音频直链多为 http，WebView 需要允许混合内容
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // 移动端 WebView 内 core 的裸 fetch 是跨域请求（歌单/榜单/播客等数据均外域），
    // 服务端无 CORS 头即被拦 → 首页推荐/歌单全空。启用后 Capacitor 自动 patch
    // window.fetch/XMLHttpRequest 走原生库，业务代码零改动消除 CORS。
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
