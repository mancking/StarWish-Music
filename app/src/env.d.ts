export {}

declare global {
  interface Window {
    sw: {
      invoke<T = any>(channel: string, payload?: any): Promise<{ ok: boolean; data?: T; error?: string }>
      on(channel: string, cb: (payload: any) => void): () => void
      platform: string
      versions: { electron: string; chrome: string; node: string }
    }
  }
}
