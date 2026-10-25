/**
 * 播放页 MV 按钮
 *
 * - 仅当前歌曲存在 MV 时显示：mvBySong 命中返回非空即亮起
 * - 查询结果缓存 5 分钟（xinyuan_mv_hint_<songHash>）
 * - 超时/无网：toast「MV 获取失败」，按钮 30 秒内不再触发（防抖）
 */
import { ref, type Ref } from 'vue'
import { call } from '@/api'
import type { MvItem, Song } from '@shared/types'

const HINT_TTL = 5 * 60_000
const FAIL_COOLDOWN = 30_000

const memory = new Map<string, { at: number; list: MvItem[] }>()
let lastFailAt = 0

export interface MvHint {
  /** 当前歌曲是否有 MV（按钮显隐） */
  has: Ref<boolean>
  loading: Ref<boolean>
  /** 命中的 MV 列表（点击时直接用，不再二次请求） */
  list: Ref<MvItem[]>
  /** 跟随切歌调用 */
  refresh: (song: Song | null) => Promise<void>
  /** 失败冷却期内点击不触发 */
  cooling: () => boolean
}

export function useMvHint(): MvHint {
  const has = ref(false)
  const loading = ref(false)
  const list = ref<MvItem[]>([])

  async function refresh(song: Song | null): Promise<void> {
    has.value = false
    list.value = []
    if (!song?.id) return
    const key = `${song.source}:${song.songId || song.id}`
    const hit = memory.get(key)
    if (hit && Date.now() - hit.at < HINT_TTL) {
      list.value = hit.list
      has.value = hit.list.length > 0
      return
    }
    loading.value = true
    try {
      const res = await call<MvItem[]>('music:mvBySong', { song })
      memory.set(key, { at: Date.now(), list: res })
      list.value = res
      has.value = res.length > 0
    } catch {
      lastFailAt = Date.now()
    } finally {
      loading.value = false
    }
  }

  function cooling(): boolean {
    return Date.now() - lastFailAt < FAIL_COOLDOWN
  }

  return { has, loading, list, refresh, cooling }
}

export function mvFailToast(): void {
  lastFailAt = Date.now()
}
