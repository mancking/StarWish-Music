/** 桥内事件总线：订阅列表仿桌面 preload 的 EVENT_WHITELIST 语义 */
type Handler = (payload: any) => void

const handlers = new Map<string, Set<Handler>>()

export const EVENT_WHITELIST = new Set([
  'player:state', 'player:tick', 'player:error', 'player:queue', 'toast',
  'scan:progress', 'sources:changed', 'settings:changed', 'theme:changed', 'window:state',
  'app:navigate', 'lyric:payload', 'player:sleep',
  // 下载进度（移动端 download:progress 与桌面同语义，此前漏登记导致进度条永不更新）
  'download:progress',
  'audio:extract:progress',
  // 应用内更新：原生下载进度与安装阶段
  'update:progress',
 // 下拉刷新：顶部下拉手势广播，各页面自行刷新数据
  'app:pull-refresh',
])

export function emit(channel: string, payload: any): void {
  const set = handlers.get(channel)
  if (!set || !set.size) return
  for (const h of [...set]) {
    try { h(payload) } catch { /* 订阅者异常不影响其他订阅 */ }
  }
}

export function subscribe(channel: string, cb: Handler): () => void {
  if (!EVENT_WHITELIST.has(channel)) return () => undefined
  let set = handlers.get(channel)
  if (!set) { set = new Set(); handlers.set(channel, set) }
  set.add(cb)
  return () => { set!.delete(cb) }
}
