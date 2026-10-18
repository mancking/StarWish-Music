/**
 * 错误信息归一化（与桌面 `electron/ipc.ts:friendly` 逐条一致）。
 * 桥必须给出同样的中文提示，否则移动端报错文案会和桌面漂移。
 */
export function friendly(e: any): string {
  const raw = String(e?.message || e || '未知错误')
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_INTERNET_DISCONNECTED/i.test(raw)) return '网络连接失败，请检查网络或代理设置'
  if (/ETIMEDOUT|timed out|超时/i.test(raw)) return '请求超时，请稍后重试'
  if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(raw)) return '连接中断，请重试'
  if (/403|Forbidden/i.test(raw)) return '音源拒绝访问，该音源可能已失效'
  if (/429|too many/i.test(raw)) return '请求过于频繁，请稍后再试'
  if (/certificate|SSL|TLS/i.test(raw)) return '证书校验失败，请检查系统时间或代理'
  return raw
}

/** 与 desktop preload 一致的信封 */
export type Envelope<T = any> = { ok: true; data: T } | { ok: false; error: string }

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data }
}

export function fail(e: any): Envelope<never> {
  return { ok: false, error: friendly(e) }
}
