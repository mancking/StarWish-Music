export {}

declare global {
  /** 构建期旗标：移动端构建(vite.mobile.config)为 true，桌面为 false。
   *  用于组件里静态分支（移动底栏 4 tab vs 桌面完整侧栏），构建后死分支被摇掉。 */
  const __MOBILE__: boolean

  /** 构建期注入的应用版本号（来自 app/package.json），避免各端硬编码版本 */
  const __APP_VERSION__: string

  interface Window {
    sw: {
      invoke<T = any>(channel: string, payload?: any): Promise<{ ok: boolean; data?: T; error?: string }>
      on(channel: string, cb: (payload: any) => void): () => void
      platform: string
      versions: { electron: string; chrome: string; node: string }
    }
  }
}
