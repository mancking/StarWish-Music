import type { ApiResult } from '@shared/types'

/**
 * 把 Vue 响应式代理转成纯数据。
 * IPC 使用结构化克隆，Proxy / Ref 等对象无法克隆（会抛 "could not be cloned"），
 * 因此所有出站参数必须先降级为普通对象。
 */
function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

/** 统一的 IPC 调用封装：所有错误都转成可展示的中文信息 */
export async function call<T = any>(channel: string, payload?: any): Promise<T> {
  try {
    const res = await window.sw.invoke<T>(channel, toPlain(payload))
    if (!res) throw new Error('主进程无响应')
    if (!res.ok) throw new Error(res.error || '操作失败')
    return res.data as T
  } catch (e: any) {
    if (String(e?.message || '').includes('No handler registered')) {
      throw new Error('应用组件尚未就绪，请稍后重试')
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export async function tryCall<T = any>(channel: string, payload?: any): Promise<T | null> {
  try {
    return await call<T>(channel, payload)
  } catch {
    return null
  }
}

export function on(channel: string, cb: (payload: any) => void): () => void {
  return window.sw.on(channel, cb)
}

export const isDesktop = typeof window !== 'undefined' && !!window.sw
