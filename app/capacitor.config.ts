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
}

export default config
