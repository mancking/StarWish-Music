import { computed, ref, type Ref } from 'vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import type { MvItem } from '@shared/types'

/**
 * 视频会话（规格书 2.2 / 2.4 / 2.10 / 2.11 / 2.12）
 *
 * 负责「取数据」：视频信息、分 P、清晰度档位、相关推荐、弹幕、续播位置。
 * 不碰 <video> 元素——播放与手势由 VideoStage 负责，页面只做装配。
 */
export interface VideoPart {
  cid: string
  page: number
  title: string
  duration?: number
}

export interface QualityOption {
  qn: number
  label: string
}

const RESUME_PREFIX = 'xinyuan_resume_'

export function resumeKey(bvid: string, cid: string): string {
  return `${RESUME_PREFIX}${bvid}_${cid}`
}

export function useVideoSession(bvid: Ref<string>) {
  const ui = useUiStore()

  const info = ref<any>(null)
  const parts = ref<VideoPart[]>([])
  const current = ref<VideoPart | null>(null)
  const related = ref<MvItem[]>([])
  const qualities = ref<QualityOption[]>([])
  const qn = ref(0)
  const src = ref('')
  const loading = ref(true)
  const error = ref('')
  const danmaku = ref<any[]>([])

  const title = computed(() => info.value?.title || current.value?.title || '视频')
  const author = computed(() => info.value?.author || '')
  const poster = computed(() => {
    const p = info.value?.pic
    if (!p) return ''
    return p.startsWith('//') ? `https:${p}` : p
  })

  /** 续播位置（规格书 2.10：>95% 视为看完，清除记录） */
  function savedPosition(cid: string): number {
    try {
      return Number(localStorage.getItem(resumeKey(bvid.value, cid)) || 0)
    } catch {
      return 0
    }
  }

  function rememberPosition(cid: string, position: number, duration: number): void {
    try {
      const key = resumeKey(bvid.value, cid)
      if (duration > 0 && position / duration > 0.95) localStorage.removeItem(key)
      else if (position > 3) localStorage.setItem(key, String(Math.round(position)))
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  async function loadDanmaku(cid: string): Promise<void> {
    if (!cid || !ui.settings.danmakuEnabled) {
      danmaku.value = []
      return
    }
    try {
      danmaku.value = await call<any[]>('mv:danmaku', { cid })
    } catch {
      danmaku.value = []
    }
  }

  async function loadRelated(): Promise<void> {
    try {
      const list = await call<MvItem[]>('music:mv', { keyword: author.value || '音乐', page: 1 })
      related.value = list.filter(v => v.bvid !== bvid.value).slice(0, 10)
    } catch {
      related.value = []
    }
  }

  /** 切换分 P / 清晰度：返回需要恢复的秒数（0 表示从头） */
  async function selectPart(part: VideoPart, wantQn?: number): Promise<number> {
    current.value = part
    error.value = ''
    loading.value = true
    try {
      const r = await call<{ url: string; qn: number; qualities: QualityOption[] }>('music:mvurl', {
        bvid: bvid.value,
        cid: part.cid,
        qn: wantQn || qn.value || undefined,
      })
      src.value = r.url
      if (r.qualities?.length) qualities.value = r.qualities
      if (r.qn) qn.value = r.qn
      void loadDanmaku(part.cid)
      const saved = savedPosition(part.cid)
      return saved > 15 ? saved : 0
    } catch (e: any) {
      error.value = e?.message || '视频流解析失败'
      return 0
    } finally {
      loading.value = false
    }
  }

  async function load(wantPage = 1): Promise<number> {
    loading.value = true
    error.value = ''
    src.value = ''
    parts.value = []
    current.value = null
    try {
      info.value = await call<any>('music:mvinfo', { bvid: bvid.value })
      try {
        parts.value = await call<VideoPart[]>('music:mvparts', { bvid: bvid.value })
      } catch {
        parts.value = []
      }
      const target = parts.value.find(p => p.page === wantPage) || parts.value[0] || null
      void loadRelated()
      if (!target) {
        error.value = '没有可播放的分 P'
        return 0
      }
      return await selectPart(target)
    } catch (e: any) {
      error.value = e?.message || '视频信息加载失败'
      return 0
    } finally {
      loading.value = false
    }
  }

  function setDanmakuEnabled(on: boolean): void {
    ;(ui.settings as any).danmakuEnabled = on
    void call('settings:set', { danmakuEnabled: on })
    if (on && current.value) void loadDanmaku(current.value.cid)
    else danmaku.value = []
  }

  return {
    info,
    parts,
    current,
    related,
    qualities,
    qn,
    src,
    loading,
    error,
    danmaku,
    title,
    author,
    poster,
    load,
    selectPart,
    loadDanmaku,
    loadRelated,
    savedPosition,
    rememberPosition,
    setDanmakuEnabled,
  }
}
