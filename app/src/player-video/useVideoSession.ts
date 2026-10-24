import { computed, ref, type Ref } from 'vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import type { MvItem } from '@shared/types'

/**
 * 视频会话（规格书 2.2 / 2.4 / 2.10 / 2.11 / 2.12）
 *
 * 负责「取数据」：视频信息、分 P、清晰度档位、相关推荐、弹幕、续播位置。
 * 不碰 <video> 元素——播放与手势由 VideoStage 负责，页面只做装配。
 *
 * 并发契约（Bug 47/93）：所有异步写 info/src/current 的入口都过 reqToken，
 * 快速切分 P / 切清晰度时旧响应直接丢弃，不以旧覆新。
 * 媒体源契约（N19）：直链统一包 swmedia 代理（桌面 swmedia:// / 移动 /swmedia/），
 * 防盗链 Referer/UA 由代理注入；离线缓存命中（Bug 110）直接用本地路径。
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

/** B 站视频沿用 xinyuan_resume_<bvid>_<cid>；MV（2.18）走 xinyuan_resume_mv_<source>_<id> */
export function resumeKey(source: string, id: string, cid: string): string {
  if (!source || source === 'bili') return `${RESUME_PREFIX}${id}_${cid}`
  return `${RESUME_PREFIX}mv_${source}_${id}_${cid}`
}

/** 直链 → 可播放地址：桌面 swmedia:// 协议；移动端同源 /swmedia/ 代理（N19） */
export function toPlayableUrl(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('/') || raw.startsWith('swmedia://') || raw.startsWith('blob:') || raw.startsWith('file:')) {
    return raw
  }
  const u = encodeURIComponent(raw)
  return __MOBILE__ ? `/swmedia/?u=${u}` : `swmedia://stream/?u=${u}`
}

export function useVideoSession(source: Ref<string>, bvid: Ref<string>) {
  const ui = useUiStore()

  const info = ref<any>(null)
  const parts = ref<VideoPart[]>([])
  const current = ref<VideoPart | null>(null)
  const related = ref<MvItem[]>([])
  const qualities = ref<QualityOption[]>([])
  const qn = ref(0)
  const src = ref('')
  /** 未包代理的原始直链（离线缓存/下载用，Bug 109 契约全字段透传） */
  const rawUrl = ref('')
  const loading = ref(true)
  const error = ref('')
  const danmaku = ref<any[]>([])

  /** Bug 47/93：会话级请求令牌，await 之后校验，过期即弃 */
  let reqToken = 0
  const nextToken = (): number => ++reqToken
  const isStale = (t: number): boolean => t !== reqToken

  const title = computed(() => info.value?.title || current.value?.title || '视频')
  const author = computed(() => info.value?.author || '')
  const poster = computed(() => {
    const p = info.value?.pic
    if (!p) return ''
    return p.startsWith('//') ? `https:${p}` : p
  })

  /** 续播位置（规格书 2.10：>95% 视为看完，清除记录；>15 秒才恢复） */
  function savedPosition(cid: string): number {
    try {
      return Number(localStorage.getItem(resumeKey(source.value, bvid.value, cid)) || 0)
    } catch {
      return 0
    }
  }

  function rememberPosition(cid: string, position: number, duration: number): void {
    try {
      const key = resumeKey(source.value, bvid.value, cid)
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

  /** 离线缓存命中则直接给本地路径（Bug 110）；MV 离线（3.6）按 source+id 键 */
  async function offlineFileFor(cid: string): Promise<string> {
    try {
      const local = await call<string>('video:offline:file', { bvid: bvid.value, cid, source: source.value || 'bili' })
      return local || ''
    } catch {
      return ''
    }
  }

  /** 切换分 P / 清晰度：返回需要恢复的秒数（0 表示从头） */
  async function selectPart(part: VideoPart, wantQn?: number): Promise<number> {
    const token = nextToken()
    current.value = part
    error.value = ''
    loading.value = true
    try {
      // 先查离线缓存，命中即本地零流量播放
      const local = await offlineFileFor(part.cid)
      if (!isStale(token)) {
        if (local) {
          src.value = local
          rawUrl.value = ''
          void loadDanmaku(part.cid)
          loading.value = false
          const saved = savedPosition(part.cid)
          return saved > 15 ? saved : 0
        }
      }
      const r = await call<{ url: string; qn: number; qualities: QualityOption[] }>('music:mvurl', {
        bvid: bvid.value,
        cid: part.cid,
        qn: wantQn || qn.value || undefined,
        source: source.value || 'bili',
      })
      if (isStale(token)) return 0
      rawUrl.value = r.url || ''
      src.value = toPlayableUrl(r.url)
      if (r.qualities?.length) qualities.value = r.qualities
      if (r.qn) qn.value = r.qn
      void loadDanmaku(part.cid)
      const saved = savedPosition(part.cid)
      return saved > 15 ? saved : 0
    } catch (e: any) {
      if (!isStale(token)) error.value = e?.message || '视频流解析失败'
      return 0
    } finally {
      if (!isStale(token)) loading.value = false
    }
  }

  async function load(wantPage = 1): Promise<number> {
    const token = nextToken()
    loading.value = true
    error.value = ''
    src.value = ''
    parts.value = []
    current.value = null
    try {
      const vi = await call<any>('music:mvinfo', { bvid: bvid.value, source: source.value || 'bili' })
      if (isStale(token)) return 0
      info.value = vi
      let ps: VideoPart[] = []
      try {
        ps = await call<VideoPart[]>('music:mvparts', { bvid: bvid.value, source: source.value || 'bili' })
      } catch {
        ps = []
      }
      if (isStale(token)) return 0
      // 网易/QQ/外部 MV 无分 P：合成单片（规格书 2.19 兜底分支）
      if (!ps.length && (source.value || 'bili') !== 'bili') {
        ps = [{ cid: String(vi?.cid || ''), page: 1, title: vi?.title || bvid.value }]
      }
      parts.value = ps
      const target = parts.value.find(p => p.page === wantPage) || parts.value[0] || null
      void loadRelated()
      if (!target) {
        error.value = '没有可播放的分 P'
        return 0
      }
      return await selectPart(target)
    } catch (e: any) {
      if (!isStale(token)) error.value = e?.message || '视频信息加载失败'
      return 0
    } finally {
      if (!isStale(token)) loading.value = false
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
    rawUrl,
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
