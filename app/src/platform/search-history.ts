/**
 * 搜索历史（规格书 3.7 / Bug 15 · 独立模块）
 *
 * xinyuan_search_history：最近 20 条，去重置顶，可单删/清空。
 * 只做持久化与列表推导，UI 由 Search.vue 消费。
 */
import { ref, type Ref } from 'vue'
import { lsJson as lsGetJson, lsSetJson } from '@/platform'

const KEY = 'search_history'
const MAX = 20

const items = ref<string[]>(lsGetJson<string[]>(KEY, []))

function persist(): void {
  lsSetJson(KEY, items.value)
}

/** 提交搜索时调用：去重置顶，上限 20 条 */
export function pushSearchHistory(kw: string): void {
  const k = String(kw || '').trim()
  if (!k) return
  items.value = [k, ...items.value.filter(x => x !== k)].slice(0, MAX)
  persist()
}

export function searchHistory(): Ref<string[]> {
  return items
}

export function removeSearchHistory(kw: string): void {
  items.value = items.value.filter(x => x !== kw)
  persist()
}

export function clearSearchHistory(): void {
  items.value = []
  persist()
}
