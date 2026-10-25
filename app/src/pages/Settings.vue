<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import Icon from '@/components/Icon.vue'
import Toggle from '@/components/Toggle.vue'
import Modal from '@/components/Modal.vue'
import Slider from '@/components/Slider.vue'
import { call, isDesktop, on } from '@/api'
import { checkUpdate, type UpdateInfo } from '@/utils/update-check'
import { searchSettings } from '@/settings/schema'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useDownloadStore } from '@/stores/download'
import { platformLabel } from '@/utils/labels'
import type { AppSettings, SourceInfo, PluginInfo, PluginSubscription } from '@shared/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()
const download = useDownloadStore()
const router = useRouter()
const settingsRoute = useRoute()

type Cat = 'appearance' | 'theme' | 'playback' | 'lyric' | 'video' | 'download' | 'sources' | 'local' | 'cache' | 'shortcuts' | 'about'
const cat = ref<Cat>('appearance')
/** 移动端设置页为「单页滚动 + 分区标题」结构，一次渲染全部分区；桌面保持单面板切换 */
const isMobileSettings = __MOBILE__
/** 移动端两级导航：'' = 分类列表页；否则为该分类的整页面板 */
const mobileCat = ref<Cat | ''>('')

/** 分类同步：URL ?cat= 任意合法分类都生效（附带修复；零音源 CTA 的 ?cat=sources 亦走此路径） */
const cats: { key: Cat; label: string; icon: string }[] = [
 //旧版「外观主题」与「主题与壁纸」两个分区内容重叠（主题色/播放页背景两边都有），
  // 合并为单一「外观与主题」分区：主题模式 → 强调色 → 皮肤 → 主题包 → 壁纸。
  { key: 'appearance', label: '外观与主题', icon: 'palette' },
  { key: 'playback', label: '播放', icon: 'play-circle' },
  { key: 'lyric', label: '歌词', icon: 'lyric' },
  { key: 'video', label: '视频与弹幕', icon: 'video' },
  { key: 'download', label: '下载', icon: 'download' },
  { key: 'sources', label: '音源与插件', icon: 'plug' },
  { key: 'local', label: '本地音乐', icon: 'folder' },
  { key: 'cache', label: '网络与缓存', icon: 'database' },
  { key: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { key: 'about', label: '关于', icon: 'info' },
]

/** 分类同步：URL ?cat= 任意合法分类都生效（附带修复；零音源 CTA 的 ?cat=sources 亦走此路径） */
watch(
  () => settingsRoute.query.cat,
  v => {
    // 旧链接 ?cat=theme 兼容（分区已并入 appearance）
    const raw = String(v || '')
    const c = (raw === 'theme' ? 'appearance' : raw) as Cat
    if (cats.some(x => x.key === c)) cat.value = c
  },
  { immediate: true }
)

/**
 * 设置项索引来自 schema（单一数据源），跨分区搜索直接查 schema。
 * 新增设置项只需在 schema 里补一条，搜索自动覆盖。
 */
const q = ref('')
const searchResults = computed(() => searchSettings(q.value, isMobile))

function catLabel(key: string): string {
  return cats.find(c => c.key === key)?.label || ''
}

function jumpTo(r: { cat: string; label: string }): void {
  cat.value = r.cat as Cat
  if (isMobileSettings) mobileCat.value = r.cat as Cat
  q.value = ''
}

const sources = ref<SourceInfo[]>([])
const sourcesLoading = ref(false)
const appInfo = ref<any>(null)
const cache = ref({ cover: 0, media: 0, total: 0 })
const bili = ref<any>({ loggedIn: false })

const importOpen = ref(false)
const importUrl = ref('')
const importText = ref('')
const importError = ref('')
const importing = ref(false)

const codeOpen = ref(false)
const codeText = ref('')
const codeName = ref('')

const deleteTarget = ref<SourceInfo | null>(null)
/** 非空表示导入弹窗处于「更新替换」模式，导入的内容将原地覆盖该音源 */
const replaceTarget = ref<SourceInfo | null>(null)
const restoring = ref(false)
const dataMoving = ref(false)

// —— MusicFree 插件库 ——
const plugins = ref<PluginInfo[]>([])
const pluginsLoading = ref(false)
const pluginImportOpen = ref(false)
const pluginImportUrl = ref('')
const pluginImportText = ref('')
const pluginImportError = ref('')
const pluginImporting = ref(false)
const pluginDeleteTarget = ref<PluginInfo | null>(null)
const subs = ref<PluginSubscription[]>([])
const subOpen = ref(false)
const subUrl = ref('')
const OFFICIAL_SUB_URL = 'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/manifest.json'
const subName = ref('')
const subError = ref('')
const subbing = ref(false)
/** 插件市场：在线目录（浏览 → 一键安装/更新） */
const marketOpen = ref(false)
const marketLoading = ref(false)
const marketError = ref('')
const marketUpdating = ref('')
/** 统一源市场条目 */
type MarketItem = {
  kind: 'lx-source' | 'musicfree-plugin' | 'video-source' | 'theme'
  id: string
  name: string
  version?: string
  author?: string
  description?: string
  url: string
  changelog?: string
  compat?: string
  commitSha?: string
  canUpdate?: boolean
  installed?: boolean
}
const marketEntries = ref<MarketItem[]>([])
const marketKind = ref<'all' | 'lx-source' | 'musicfree-plugin' | 'video-source'>('all')
const marketKeyword = ref('')
const marketDetailId = ref('')
/** 插件市场与主题市场是两个不同分支：主题不混入插件市场（主题市场在「外观与主题」分区） */
const KIND_TABS = [
  { key: 'all', label: '全部' },
  { key: 'lx-source', label: '音源' },
  { key: 'musicfree-plugin', label: '插件' },
  { key: 'video-source', label: '视频源' },
] as const
const KIND_LABEL: Record<string, string> = {
  'lx-source': '音源',
  'musicfree-plugin': '插件',
  'video-source': '视频源',
}
const marketFiltered = computed(() => {
  const kw = marketKeyword.value.trim().toLowerCase()
  return marketEntries.value.filter(
    m =>
      m.kind !== 'theme' &&
      (marketKind.value === 'all' || m.kind === marketKind.value) &&
      (!kw || `${m.name} ${m.description || ''} ${m.author || ''}`.toLowerCase().includes(kw))
  )
})
/** 数据目录改过之后，存下重启后的目标路径，用于提示横幅 */
const dataRestart = ref('')

const qrOpen = ref(false)
const qrImg = ref('')
const qrStatus = ref('')
const qrKey = ref('')
let qrTimer: number | null = null
const loginTab = ref<'qr' | 'pwd' | 'cookie'>('qr')
const isMobileApp = __MOBILE__
const biliQrUrl = ref('')
const pwdUser = ref('')
const pwdPass = ref('')
const pwdBusy = ref(false)
const pwdErr = ref('')
const ckText = ref('')
const ckBusy = ref(false)
const ckErr = ref('')

const ACCENTS = ['#ff4d6d', '#a855f7', '#3cb371', '#4f9cf9', '#f0b429', '#ff7a45', '#22d3ee', '#e879f9']

const qualityOptions: { value: AppSettings['quality']; label: string }[] = [
  { value: '128k', label: '标准 128K' },
  { value: '320k', label: '高品质 320K' },
  { value: 'flac', label: '无损 FLAC' },
  { value: 'flac24bit', label: 'Hi-Res 24bit' },
]

const setting = computed(() => ui.settings)

/*车机模式退出入口 + c10：手机粒子开关真实生效（写 xinyuan_particle_phone） */
import { clearCarMode, isCarDevice, lsGet, lsSet } from '@/platform'
const carMode = ref(isCarDevice())
/* 4.8 局域网同步（桌面主机端） */
const lanInfo = ref<{ active: boolean; port: number; pin: string; ips: string[]; lastSyncAt: number }>({
  active: false,
  port: 42717,
  pin: '',
  ips: [],
  lastSyncAt: 0,
})
const lanBusy = ref(false)
async function lanStart(): Promise<void> {
  lanBusy.value = true
  try {
    lanInfo.value = await call<any>('lan:start')
    ui.toast('同步主机已开启', 'success', 1600)
  } catch (e: any) {
    ui.toast(e?.message || '开启失败', 'error', 2000)
  } finally {
    lanBusy.value = false
  }
}
async function lanStop(): Promise<void> {
  await call('lan:stop').catch(() => undefined)
  lanInfo.value = { active: false, port: 42717, pin: '', ips: [], lastSyncAt: 0 }
}
onMounted(() => {
  void call<any>('lan:info').then(r => {
    if (r?.active) lanInfo.value = r
  })
})
const particlePhone = ref(lsGet('particle_phone') === '1')
function setParticlePhone(on: boolean): void {
  particlePhone.value = on
  lsSet('particle_phone', on ? '1' : '0')
  void patch({ particle: on })
}
function exitCarMode(): void {
  clearCarMode()
  carMode.value = false
  ui.toast('已退出车机模式', 'success', 1800)
  window.setTimeout(() => location.reload(), 600)
}

async function patch(p: Partial<AppSettings>): Promise<void> {
  await ui.patch(p)
  // Persisted accent updates (e.g. the hue spectrum) must immediately reach CSS tokens.
  if (p.accent !== undefined || p.accentMode !== undefined || p.theme !== undefined) ui.apply()
}

/* ---------------- 播放页背景（四模式 + 转速档） ---------------- */

const isMobile = __MOBILE__
/** 应用版本号：构建期注入，与 app/package.json 一致 */
const appVersion = __APP_VERSION__

/* ---------------- 主题与壁纸（4.7+ · · · /39） ---------------- */
type ThemeTab = 'theme' | 'wallpaper'
const themeTab = ref<ThemeTab>('theme')

interface ThemeItem {
  id: string
  name: string
  author: string
  version: string
  colors: { primary?: string; accent?: string; bg?: string; text?: string }
  kind: 'preset' | 'local' | 'market' | 'url' | 'branch'
  desc?: string
}
const themes = ref<ThemeItem[]>([])
const activeThemeId = ref('default')

async function loadThemes(): Promise<void> {
  try {
    const r = await call<{ themes: ThemeItem[]; active: string }>('theme:list')
    themes.value = r?.themes || []
    activeThemeId.value = r?.active || 'default'
  } catch {
    themes.value = []
  }
}

async function useTheme(id: string): Promise<void> {
  try {
    await call('theme:apply', { id })
    activeThemeId.value = id
    ui.toast('主题已应用', 'success', 1400)
  } catch (e: any) {
    ui.toast(e?.message || '应用失败', 'error', 2000)
  }
}

async function removeThemePkg(id: string): Promise<void> {
  try {
    const r = await call<{ restored: string }>('theme:remove', { id })
    activeThemeId.value = r?.restored || 'default'
    await loadThemes()
    ui.toast('已卸载并恢复默认主题', 'info', 1600)
  } catch (e: any) {
    ui.toast(e?.message || '卸载失败', 'error', 2000)
  }
}

/* 强调色预设与色相谱选择 */
const THEME_SWATCHES = [
  '#a78bfa', '#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#f87171',
  '#22d3ee', '#c084fc', '#fb923c', '#4ade80', '#e879f9', '#94a3b8',
]
const themeHue = ref(265)
async function pickSwatch(c: string): Promise<void> {
  await patch({ accentMode: 'custom', accent: c })
}
async function pickHue(h: number): Promise<void> {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    const a = 0.35 * 0.55
    const v = 0.72 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(v * 255)
  }
  await patch({ accentMode: 'custom', accent: `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}` })
}

/* 本地导入主题包 JSON（≤256KB 白名单校验， */
const themeFileInput = ref<HTMLInputElement | null>(null)
async function onThemeFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const r = await call<{ theme: ThemeItem; dropped: string[] }>('theme:import', { content: text, origin: 'local' })
    await loadThemes()
    const dropped = r?.dropped?.length ? `（忽略非法字段：${r.dropped.join('、')}）` : ''
    ui.toast(`主题包「${r.theme.name}」已导入${dropped}`, 'success', 2400)
  } catch (err: any) {
    ui.toast(err?.message || '导入失败', 'error', 2400)
  }
}

/* 本地壁纸库（4.7+ ② 本地部分） */
interface WallItem { id: string; name: string; url: string }
const walls = ref<WallItem[]>([])
async function loadWalls(): Promise<void> {
  try {
    const list = await call<any[]>('wallpaper:list')
    walls.value = (list || []).map(w => ({ id: String(w.id), name: String(w.name || ''), url: String(w.url || w.file || '') }))
  } catch {
    walls.value = []
  }
}
async function useWallpaper(id: string): Promise<void> {
  await patch({ playerBg: 'wallpaper', wallpaperId: id, wallpaperEnabled: true })
  ui.toast('壁纸已应用为播放页背景', 'success', 1600)
}
async function addLocalWallpaper(): Promise<void> {
  try {
    const p = await call<string>('wallpaper:pick')
    if (!p) return
    const item = await call<any>('wallpaper:import', { path: p })
    await loadWalls()
    await useWallpaper(item.id)
  } catch (e: any) {
    ui.toast(e?.message || '导入失败', 'error', 2000)
  }
}
async function removeWall(id: string): Promise<void> {
  try {
    await call('wallpaper:remove', { id })
    await loadWalls()
  } catch (e: any) {
    ui.toast(e?.message || '删除失败', 'error', 1800)
  }
}

/* 开源壁纸在线（/ / ：打开即默认列表 + 搜索过滤 + 加载更多） */
interface OnlineWall { id: string; thumb: string; full: string; w: number; h: number; source: string; author?: string }
const onlineWalls = ref<OnlineWall[]>([])
const onlineLoading = ref(false)
const onlineFailed = ref(false)
const onlineEnd = ref(false)
const onlineSource = ref('')
const onlinePage = ref(0)
const onlineQ = ref('')
const onlineQInput = ref('')
const onlinePreview = ref<OnlineWall | null>(null)
let onlineSearchTimer = 0
let onlineBusy = 0

async function loadOnlineWalls(refresh = false): Promise<void> {
  if (onlineLoading.value || (onlineEnd.value && !refresh)) return
  onlineLoading.value = true
  onlineFailed.value = false
  try {
    const page = refresh ? 1 : onlinePage.value + 1
    const r = await call<{ list: OnlineWall[]; source: string; degraded: boolean; end: boolean }>('wallpaper:online:list', {
      page,
      q: onlineQ.value,
      refresh,
    })
    const list = r?.list || []
    if (refresh || page === 1) onlineWalls.value = list
    else onlineWalls.value = [...onlineWalls.value, ...list]
    onlinePage.value = page
    onlineSource.value = r?.source || ''
    onlineEnd.value = !!r?.end
    onlineFailed.value = !!r?.degraded
  } catch {
    onlineFailed.value = true
  } finally {
    onlineLoading.value = false
  }
}

function onOnlineSearchInput(): void {
  window.clearTimeout(onlineSearchTimer)
  onlineSearchTimer = window.setTimeout(() => {
    const q = onlineQInput.value.trim()
    if (q === onlineQ.value) return
    onlineQ.value = q
    onlineEnd.value = false
    void loadOnlineWalls(true)
  }, 300)
}

async function downloadOnline(w: OnlineWall): Promise<void> {
  if (onlineBusy >= 2) {
    ui.toast('下载并发已达上限（2），请稍候', 'info', 1600)
    return
  }
  onlineBusy++
  try {
    const item = await call<any>('wallpaper:online:download', { url: w.full })
    await loadWalls()
    await useWallpaper(item.id)
    onlinePreview.value = null
  } catch (e: any) {
    ui.toast(e?.message || '下载失败', 'error', 2200)
  } finally {
    onlineBusy--
  }
}

const wallCache = ref<{ bytes: number; files: number }>({ bytes: 0, files: 0 })
async function loadWallCache(): Promise<void> {
  try {
    wallCache.value = await call<{ bytes: number; files: number }>('wallpaper:cache:size')
  } catch {
    wallCache.value = { bytes: 0, files: 0 }
  }
}
async function clearWallCache(): Promise<void> {
  try {
    await call('wallpaper:cache:clear')
    await loadWallCache()
    ui.toast('壁纸缓存已清理', 'success', 1600)
  } catch (e: any) {
    ui.toast(e?.message || '清理失败', 'error', 1800)
  }
}

/* 大图预览浮层（≤1280px） */
async function previewDownload(): Promise<void> {
  if (onlinePreview.value) await downloadOnline(onlinePreview.value)
}

// 打开「主题与壁纸」即加载（打开即列表，不空白）
watch(
  themeTab,
  t => {
    if (t === 'theme' && !themes.value.length) void loadThemes()
    if (t === 'wallpaper') {
      if (!walls.value.length) void loadWalls()
      if (!onlineWalls.value.length) void loadOnlineWalls(true)
      void loadWallCache()
    }
  },
  { immediate: true }
)

/** 当前播放页背景模式 */
const bgMode = computed<AppSettings['playerBg']>(() => {
  const v = String(setting.value.playerBg || 'cover')
 //旧 wallpaper 归并移除，存量值映射到 cover
  return (v === 'wallpaper' ? 'cover' : v) as AppSettings['playerBg']
})
/** 唱片转速档（3.14：24/16/8，默认 16） */
const spinSec = computed(() => Number(setting.value.playerSpinSec) || 16)

/* ---------------- 睡眠定时 ---------------- */
async function setSleep(minutes: number): Promise<void> {
  try {
    await call('player:sleep', { minutes })
    await patch({ sleepTimerMin: minutes })
    ui.toast(minutes ? `${minutes} 分钟后停止播放` : '已取消睡眠定时', 'info', 1600)
  } catch (e: any) {
    ui.toast(e?.message || '设置失败', 'error')
  }
}

/* ---------------- WebDAV 备份 ---------------- */
const webdavBusy = ref(false)
const webdavMsg = ref('')

async function testWebdav(): Promise<void> {
  webdavBusy.value = true
  webdavMsg.value = ''
  try {
    const r = await call<{ ok: boolean; status: number; message: string }>('webdav:test')
    webdavMsg.value = r?.message || ''
    ui.toast(r?.ok ? '连接正常' : r?.message || '连接失败', r?.ok ? 'success' : 'error', 2600)
  } catch (e: any) {
    webdavMsg.value = e?.message || '连接失败'
    ui.toast(webdavMsg.value, 'error', 2600)
  } finally {
    webdavBusy.value = false
  }
}

async function uploadWebdav(): Promise<void> {
  webdavBusy.value = true
  try {
    const r = await call<{ bytes: number; playlists: number; favorites: number }>('webdav:upload')
    ui.toast(`已上传 ${r.playlists} 个歌单、${r.favorites} 首收藏`, 'success', 2800)
  } catch (e: any) {
    ui.toast(e?.message || '上传失败', 'error', 3200)
  } finally {
    webdavBusy.value = false
  }
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function loadSources(): Promise<void> {
  sourcesLoading.value = true
  try {
    sources.value = await call<SourceInfo[]>('sources:list')
  } catch (e: any) {
    ui.toast(`音源列表加载失败：${e.message}`, 'error')
  } finally {
    sourcesLoading.value = false
  }
}

async function loadMeta(): Promise<void> {
  const [info, c, b] = await Promise.all([
    call<any>('app:info').catch(() => null),
    call<any>('cache:size').catch(() => ({ cover: 0, media: 0, total: 0 })),
    call<any>('bili:status').catch(() => ({ loggedIn: false })),
  ])
  appInfo.value = info
  cache.value = c
  bili.value = b
}

async function toggleSource(s: SourceInfo): Promise<void> {
  try {
    // 启用走重新初始化（落雪式状态机）：返回 {sources, ok, message}
    const r = await call<{ sources: SourceInfo[]; ok: boolean; message?: string }>('sources:toggle', { file: s.file, enabled: !s.enabled })
    sources.value = r.sources
    if (r.ok) ui.toast(s.enabled ? `已停用 ${s.name}` : `${s.name} 初始化成功`, 'success', 1600)
    else ui.toast(r.message || `${s.name} 初始化失败，已回滚为停用`, 'error', 3200)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function viewCode(s: SourceInfo): Promise<void> {
  try {
    codeText.value = await call<string>('sources:code', { file: s.file })
    codeName.value = s.name
    codeOpen.value = true
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function doDelete(): Promise<void> {
  const s = deleteTarget.value
  if (!s) return
  try {
    sources.value = await call<SourceInfo[]>('sources:delete', { file: s.file })
    ui.toast('音源已删除', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    deleteTarget.value = null
  }
}

function onFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result || '')
    importUrl.value = ''
  }
  reader.readAsText(f, 'utf-8')
}

async function doImport(): Promise<void> {
  importError.value = ''
  if (!importUrl.value.trim() && !importText.value.trim()) {
    importError.value = '请填写音源链接或选择本地 JS 文件'
    return
  }
  importing.value = true
  try {
    // replaceFile 非空＝更新替换该音源（原地覆盖，保留启用状态）
    const r = await call<{ file: string; sources: SourceInfo[] }>('sources:import', {
      url: importUrl.value.trim() || undefined,
      content: importText.value || undefined,
      file: replaceTarget.value?.file,
    })
    sources.value = r.sources
    const wasUpdate = !!replaceTarget.value
    importOpen.value = false
    replaceTarget.value = null
    importUrl.value = ''
    importText.value = ''
    ui.toast(wasUpdate ? `音源「${r.file}」已更新` : `音源「${r.file}」导入成功`, 'success')
  } catch (e: any) {
    importError.value = e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

/** 打开「更新替换」弹窗：按当前音源重新下载或改用本地文件覆盖 */
function updateSource(s: SourceInfo): void {
  replaceTarget.value = s
  importOpen.value = true
}

// —— MusicFree 插件库 ——
async function loadPlugins(): Promise<void> {
  pluginsLoading.value = true
  try {
    plugins.value = await call<PluginInfo[]>('plugins:list')
  } catch (e: any) {
    ui.toast(`插件列表加载失败：${e.message}`, 'error')
  } finally {
    pluginsLoading.value = false
  }
}

async function loadSubs(): Promise<void> {
  try {
    subs.value = await call<PluginSubscription[]>('plugins:subs:list')
  } catch {
    subs.value = []
  }
}

async function togglePlugin(p: PluginInfo): Promise<void> {
  try {
    const r = await call<{ list: PluginInfo[]; ok: boolean; message?: string }>('plugins:toggle', { file: p.file, enabled: !p.enabled })
    plugins.value = r.list
    if (r.ok) ui.toast(p.enabled ? `已停用 ${p.name}` : `${p.name} 初始化成功`, 'success', 1600)
    else ui.toast(r.message || `${p.name} 初始化失败，已回滚为停用`, 'error', 3200)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

/** 打开源市场（0.10）：统一 manifest，kind 分发三类源；自定义市场 URL */
/** force=true 绕过缓存强制拉远端（用户点「刷新」；修「上传新音源拉取不到」） */
async function loadMarket(force = false): Promise<void> {
  marketOpen.value = true
  marketLoading.value = true
  marketError.value = ''
  try {
    const url = String(setting.value.marketUrl || '').trim() || OFFICIAL_SUB_URL
    marketEntries.value = (await call<MarketItem[]>('market:list', { url, force })).filter(item => item.kind !== 'theme')
    if (!marketEntries.value.length) marketError.value = '目录为空'
  } catch (e: any) {
    marketError.value = `源市场加载失败：${e.message}`
  } finally {
    marketLoading.value = false
  }
}

/** 某个市场条目是否已安装（按 file 名匹配） */
function isInstalled(file: string): PluginInfo | undefined {
  return plugins.value.find(p => p.file === file)
}

/** 主题市场入口：独立于插件市场（Star-Wish-Theme-Library 分支）。
 *  在线主题库列表在「外观与主题」分区的主题 Tab 内直接展示。 */
async function openThemeMarket(): Promise<void> {
  themeTab.value = 'theme'
  void loadThemeMarket()
}

/** 在线主题库（Star-Wish-Theme-Library 分支 manifest；与插件市场分支相互独立） */
const THEME_MARKET_URL =
  'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Theme-Library/manifest.json'
const themeMarketItems = ref<MarketItem[]>([])
const themeMarketLoading = ref(false)
const themeMarketError = ref('')
async function loadThemeMarket(force = false): Promise<void> {
  themeMarketLoading.value = true
  themeMarketError.value = ''
  try {
    themeMarketItems.value = await call<MarketItem[]>('market:themes', { url: THEME_MARKET_URL, force })
  } catch (e: any) {
    themeMarketItems.value = []
    themeMarketError.value = e?.message || '主题库加载失败'
  } finally {
    themeMarketLoading.value = false
  }
}
async function installThemeFromMarket(entry: MarketItem): Promise<void> {
  try {
    await call('market:install', { item: entry })
    ui.toast(`已安装 ${entry.name}`, 'success', 1800)
    await Promise.all([loadThemes(), loadThemeMarket()])
  } catch (e: any) {
    ui.toast(`安装失败：${e?.message || e}`, 'error', 3200)
  }
}
async function uninstallThemeFromMarket(entry: MarketItem): Promise<void> {
  try {
    await call('market:uninstall', { item: entry })
    ui.toast(`已卸载 ${entry.name}`, 'info', 1600)
    await Promise.all([loadThemes(), loadThemeMarket()])
  } catch (e: any) {
    ui.toast(`卸载失败：${e?.message || e}`, 'error', 2800)
  }
}

/** 从市场安装/更新一个插件 */
/**统一安装（kind 路由 lxHost / mfHost） */
async function installFromMarket(entry: MarketItem): Promise<void> {
  marketUpdating.value = entry.url
  // 已装且有新版本 → 更新；已装且已是最新 → 不该再点（按钮已禁用，双保险）
  const isUpdate = !!entry.installed && !!entry.canUpdate
  try {
    await call(isUpdate ? 'market:update' : 'market:install', { item: entry })
    ui.toast(`${isUpdate ? '已更新' : '已安装'} ${entry.name}（${KIND_LABEL[entry.kind]}）`, 'success')
    await loadPlugins()
    await loadMarket()
  } catch (e: any) {
    ui.toast(`${entry.name}：${e.message}`, 'error')
  } finally {
    marketUpdating.value = ''
  }
}

/** 卸载（按 sourceUrl 匹配， */
async function uninstallFromMarket(entry: MarketItem): Promise<void> {
  marketUpdating.value = entry.url
  try {
    await call('market:uninstall', { item: entry })
    ui.toast(`已卸载 ${entry.name}`, 'info')
    await loadPlugins()
    await loadMarket()
  } catch (e: any) {
    ui.toast(`${entry.name}：${e.message}`, 'error')
  } finally {
    marketUpdating.value = ''
  }
}

/** 已安装插件原地更新：按保存的来源地址重新下载并覆盖同名文件（需求 7 插件替换） */
async function updatePlugin(p: PluginInfo): Promise<void> {
  if (!p.sourceUrl) return
  marketUpdating.value = p.file
  try {
    await call('plugins:import', { url: p.sourceUrl, file: p.file, origin: p.origin })
    ui.toast(`${p.name} 已更新到最新版本`, 'success')
    await loadPlugins()
  } catch (e: any) {
    ui.toast(`${p.name} 更新失败：${e.message}`, 'error')
  } finally {
    marketUpdating.value = ''
  }
}
async function viewPluginCode(p: PluginInfo): Promise<void> {
  try {
    codeText.value = await call<string>('plugins:code', { file: p.file })
    codeName.value = p.name
    codeOpen.value = true
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function doDeletePlugin(): Promise<void> {
  const p = pluginDeleteTarget.value
  if (!p) return
  try {
    plugins.value = await call<PluginInfo[]>('plugins:delete', { file: p.file })
    ui.toast('插件已删除', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    pluginDeleteTarget.value = null
  }
}

function onPluginFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    pluginImportText.value = String(reader.result || '')
    pluginImportUrl.value = ''
  }
  reader.readAsText(f, 'utf-8')
}

const PLUGIN_TYPE_LABEL: Record<string, string> = {
  music: '歌曲',
  album: '专辑',
  artist: '歌手',
  sheet: '歌单',
  lyric: '歌词',
  comment: '评论',
  mv: '视频',
}
function pluginTypeLabel(t: string): string {
  return PLUGIN_TYPE_LABEL[t] || t
}

/** 插件不再分组：插件库就是用户安装的扁平列表（来源统一为插件市场/订阅/本地导入） */

async function doImportPlugin(): Promise<void> {
  pluginImportError.value = ''
  if (!pluginImportUrl.value.trim() && !pluginImportText.value.trim()) {
    pluginImportError.value = '请填写插件链接或选择本地插件文件'
    return
  }
  pluginImporting.value = true
  try {
    const r = await call<{ file: string; plugins: PluginInfo[] }>('plugins:import', {
      url: pluginImportUrl.value.trim() || undefined,
      content: pluginImportText.value || undefined,
    })
    plugins.value = r.plugins
    pluginImportOpen.value = false
    pluginImportUrl.value = ''
    pluginImportText.value = ''
    ui.toast(`插件「${r.file}」导入成功`, 'success')
  } catch (e: any) {
    pluginImportError.value = e?.message || '导入失败'
  } finally {
    pluginImporting.value = false
  }
}

async function doSubscribe(): Promise<void> {
  subError.value = ''
  if (!subUrl.value.trim()) {
    subError.value = '请填写订阅源链接'
    return
  }
  subbing.value = true
  try {
    const r = await call<{ added: number; updated: number; subscriptions: PluginSubscription[] }>('plugins:subscribe', {
      url: subUrl.value.trim(),
      name: subName.value.trim() || undefined,
    })
    subs.value = r.subscriptions
    subOpen.value = false
    subUrl.value = ''
    subName.value = ''
    await loadPlugins()
    ui.toast(`订阅更新完成：新增 ${r.added}，更新 ${r.updated}`, 'success')
  } catch (e: any) {
    subError.value = e?.message || '订阅失败'
  } finally {
    subbing.value = false
  }
}

async function removeSub(url: string): Promise<void> {
 //移除订阅时询问是否同时卸载该订阅下插件
  let uninstall = false
  try {
    uninstall = window.confirm('移除订阅时是否同时卸载该订阅安装的插件？（取消则仅移除订阅记录）')
  } catch {
    uninstall = false
  }
  try {
    subs.value = await call<PluginSubscription[]>('plugins:subs:remove', { url, uninstall })
    await loadPlugins()
    ui.toast('订阅已移除', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

const cachePath = computed(() => setting.value.cacheDir || `${appInfo.value?.userData || ''}\\cache`)
const coverPath = computed(() => setting.value.coverDir || `${cachePath.value}\\covers`)
const mediaPath = computed(() => setting.value.mediaDir || `${cachePath.value}\\media`)
const logPath = computed(() => setting.value.logDir || `${appInfo.value?.userData || ''}\\logs`)
// 歌词动态来源：列出本次查询实际尝试并返回候选的来源，优先（source）用「·」高亮标注
const lyricSourcesText = computed(() => {
  const l = player.lyric
  if (!l) return '暂无'
  const list = l.sources && l.sources.length ? l.sources : l.source ? [l.source] : []
  if (!list.length) return '暂无'
  const preferred = l.source
  return list.map(s => (s === preferred ? `${s}·当前` : s)).join(' / ')
})
const dataPath = computed(() => appInfo.value?.userData || '')

type DirKind = 'cache' | 'cover' | 'media'

async function pickDir(title: string): Promise<string> {
  return (await call<string>('cache:pickDir', { title })) || ''
}

async function changeCacheDir(): Promise<void> {
  try {
    const dir = await pickDir('选择缓存目录')
    if (!dir) return
    await call('cache:setDir', { dir, kind: 'cache' })
    cache.value = await call('cache:size').catch(() => cache.value)
    ui.toast('缓存目录已更新，已有缓存已迁移', 'success')
    await loadMeta()
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function changeSubDir(kind: Exclude<DirKind, 'cache'>, label: string): Promise<void> {
  try {
    const dir = await pickDir(`选择${label}目录`)
    if (!dir) return
    await call('cache:setDir', { dir, kind })
    cache.value = await call('cache:size').catch(() => cache.value)
    ui.toast(`${label}目录已更新，已有缓存已迁移`, 'success')
    await loadMeta()
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

/** 下载目录：走 download:pickDir（主进程选目录后直接写设置），与缓存目录迁移是两套逻辑 */
async function changeDownloadDir(): Promise<void> {
  try {
    const dir = await call<string>('download:pickDir')
    if (!dir) return
    download.dir = dir
    ui.toast('下载目录已更新', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function resetDownloadDir(): Promise<void> {
  try {
    await patch({ downloadDir: '' })
    download.dir = await call<string>('download:dir')
    ui.toast('已恢复默认下载目录', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function openDownloadDir(): Promise<void> {
  try {
    await call('download:openDir')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function changeLogDir(): Promise<void> {  try {
    const dir = await pickDir('选择日志目录')
    if (!dir) return
    if (parseDir(dir) === parseDir(logPath.value)) {
      ui.toast('新目录与当前日志目录相同', 'info')
      return
    }
    await call('log:setDir', { dir })
    ui.toast('日志目录已更新，后续日志写入新目录', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function resetLogDir(): Promise<void> {
  try {
    await call('log:setDir', { dir: '' })
    ui.toast('已恢复默认日志目录', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function changeDataDir(): Promise<void> {
  if (dataMoving.value) return
  try {
    const dir = await pickDir('选择数据目录')
    if (!dir) return
    if (parseDir(dir) === parseDir(dataPath.value)) {
      ui.toast('新目录与当前数据目录相同', 'info')
      return
    }
    dataMoving.value = true
    const r = await call<{ dir: string; restart: boolean }>('data:setDir', { dir })
    if (r.restart) {
      dataRestart.value = r.dir
      ui.toast('数据目录已迁移，重启后生效', 'success')
    }
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    dataMoving.value = false
  }
}

function parseDir(s: string): string {
  return String(s || '').replace(/[\\/]+$/, '').toLowerCase()
}

async function resetCacheDir(): Promise<void> {
  try {
    await call('cache:setDir', { dir: '' })
    await loadMeta()
    ui.toast('已恢复默认缓存目录', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function openCacheDir(kind: DirKind = 'cache'): Promise<void> {
  await call('cache:openDir', { kind }).catch(() => {})
}

async function clearCache(scope: 'cover' | 'media' | 'all'): Promise<void> {
  try {
    cache.value = await call('cache:clear', { scope })
    ui.toast(scope === 'cover' ? '封面缓存已清理' : scope === 'media' ? '媒体缓存已清理' : '缓存已清理', 'success')
    await loadMeta()
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function resetDataDir(): Promise<void> {
  if (dataMoving.value) return
  try {
    dataMoving.value = true
    const r = await call<{ dir: string; restart: boolean }>('data:setDir', { dir: '' })
    if (r.restart) {
      dataRestart.value = r.dir
      ui.toast('已恢复默认数据目录，重启后生效', 'success')
    } else {
      ui.toast('当前已是默认数据目录', 'info')
    }
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    dataMoving.value = false
  }
}

async function clearDataJunk(): Promise<void> {
  try {
    const r = await call<{ freed: number }>('data:clear')
    ui.toast(`已清理 ${fmtBytes(r.freed)} 可再生的数据`, 'success')
    await loadMeta()
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function openDataDir(): Promise<void> {
  await call('data:openDir').catch(() => {})
}

/** 检查更新（桌面/移动共用，见 utils/update-check.ts） */
const updateChecking = ref(false)
const updateInfo = ref<UpdateInfo | null>(null)
async function doCheckUpdate(): Promise<void> {
  if (updateChecking.value) return
  updateChecking.value = true
  try {
    const cur = String(appInfo.value?.version || appVersion)
    updateInfo.value = await checkUpdate(cur)
    if (updateInfo.value.hasUpdate) {
      ui.toast(`发现新版本 v${updateInfo.value.version}`, 'success')
    } else {
      ui.toast('当前已是最新版本', 'success')
    }
  } catch (e: any) {
    // GitHub API 在部分网络环境不可达：给出可执行的替代动作
    updateInfo.value = null
    ui.toast(`检查更新失败：${e.message}。可用浏览器打开 Releases 页手动下载`, 'error', 5000)
    try {
      await navigator.clipboard.writeText(`https://github.com/mancking/StarWish-Music/releases`)
    } catch { /* 剪贴板不可用 */ }
  } finally {
    updateChecking.value = false
  }
}

async function openUpdatePage(): Promise<void> {
  const url = updateInfo.value?.url || `https://github.com/${'mancking/StarWish-Music'}/releases/latest`
  if (isDesktop) {
    // 桌面端：优先应用内下载安装包（Windows 便携 exe / macOS zip），失败再退回浏览器
    const desktopUrl = updateInfo.value?.desktopUrl
    if (desktopUrl) {
      await desktopInstall(desktopUrl)
      return
    }
    await call('app:openExternal', { url }).catch(() => {})
    return
  }
  // v1.0.0：Release 里有 APK 产物时应用内直接下载并拉起安装器，不再跳浏览器
  const apkUrl = updateInfo.value?.apkUrl
  if (apkUrl) {
    ui.toast('开始下载安装包，完成后会自动拉起安装器…', 'info', 3600)
    try {
      await call('app:downloadAndInstall', { url: apkUrl })
      ui.toast('下载完成，请在弹出的安装器中确认安装（首次需允许「安装未知应用」）', 'success', 6000)
    } catch (e: any) {
      ui.toast(`下载失败：${e.message}，已复制下载页链接`, 'error', 4600)
      try {
        await navigator.clipboard.writeText(url)
      } catch { /* 剪贴板不可用 */ }
    }
    return
  }
  // 无 APK 产物：直接用系统浏览器打开 Release 页（SwBridge openExternal）
  try {
    await call('app:openExternal', { url })
    ui.toast('已打开下载页，请在 Assets 中下载 APK', 'info', 3600)
  } catch {
    try {
      await navigator.clipboard.writeText(url)
      ui.toast('下载页链接已复制，请在浏览器打开', 'success')
    } catch {
      ui.toast(url, 'info', 8000)
    }
  }
}

async function restartApp(): Promise<void> {
  await call('app:relaunch').catch(() => {})
}

/* ---------------- 桌面端应用内更新（下载安装包 → 重启替换） ---------------- */
const desktopUpdating = ref(false)
const desktopProgress = ref<{ received: number; total: number; percent: number; phase: string } | null>(null)
const desktopFilePath = ref('')
let offDesktopProgress: (() => void) | null = null

function ensureDesktopProgressListener(): void {
  if (offDesktopProgress) return
  offDesktopProgress = on('update:progress', (p: any) => {
    if (!p) return
    desktopProgress.value = {
      received: Number(p.received || 0),
      total: Number(p.total || 0),
      percent: Number(p.percent || 0),
      phase: String(p.phase || 'downloading'),
    }
  })
}

async function desktopInstall(downloadUrl: string): Promise<void> {
  if (desktopUpdating.value) return
  desktopUpdating.value = true
  desktopProgress.value = null
  desktopFilePath.value = ''
  ensureDesktopProgressListener()
  try {
    const r = await call<{ path: string; fileName: string }>('app:downloadUpdate', {
      url: downloadUrl,
      version: updateInfo.value?.version || '',
    })
    desktopFilePath.value = r.path
    ui.toast(`新版本已下载：${r.fileName}`, 'success', 5000)
  } catch (e: any) {
    ui.toast(`更新包下载失败：${e.message}，已改为打开下载页`, 'error', 5000)
    const url = updateInfo.value?.url || 'https://github.com/mancking/StarWish-Music/releases/latest'
    await call('app:openExternal', { url }).catch(() => {})
  } finally {
    desktopUpdating.value = false
  }
}

/** 用已下载的新版可执行文件重启（便携版：拉起新 exe 后退出旧进程） */
async function applyDesktopUpdate(): Promise<void> {
  if (!desktopFilePath.value) return
  await call('app:relaunchWithUpdate', { path: desktopFilePath.value }).catch(() => {})
}

/** 不重启，只在文件夹中显示已下载的安装包 */
async function revealDesktopUpdate(): Promise<void> {
  if (!desktopFilePath.value) return
  await call('app:showUpdateFile', { path: desktopFilePath.value }).catch(() => {})
}

async function restoreSources(): Promise<void> {
  if (restoring.value) return
  restoring.value = true
  try {
    sources.value = await call<SourceInfo[]>('sources:restore')
    ui.toast('已恢复全部内置音源', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  } finally {
    restoring.value = false
  }
}

async function startBiliLogin(): Promise<void> {
  qrOpen.value = true
  loginTab.value = 'qr'
  pwdErr.value = ''
  ckErr.value = ''
  qrStatus.value = '正在获取二维码…'
  qrImg.value = ''
  stopPoll()
  try {
    const r = await call<{ url: string; key: string }>('bili:qr')
    qrKey.value = r.key
    biliQrUrl.value = r.url
    qrImg.value = await QRCode.toDataURL(r.url, { margin: 1, width: 220, color: { dark: '#111827', light: '#ffffff' } })
    qrStatus.value = '请使用哔哩哔哩 App 扫码，或点下方按钮拉起客户端'
    qrTimer = window.setInterval(poll, 2000)
  } catch (e: any) {
    qrStatus.value = e?.message || '二维码获取失败'
  }
}

function switchLoginTab(t: 'qr' | 'pwd' | 'cookie'): void {
  loginTab.value = t
  pwdErr.value = ''
  ckErr.value = ''
  // 二维码过期/出错后切回扫码页时自动重新生成
  if (t === 'qr' && !qrImg.value) void startBiliLogin()
}

/** 拉起哔哩哔哩客户端确认登录（手机上点开即弹确认，无需第二台设备扫码） */
function openBiliApp(): void {
  if (!biliQrUrl.value) {
    ui.toast('二维码尚未生成', 'info')
    return
  }
  // bilibili:// scheme 打开 B 站 App 内置浏览器并载入确认页；
  // Android 11+ 需要 AndroidManifest 里 <queries> 声明该 scheme
  window.location.href = 'bilibili://browser?url=' + encodeURIComponent(biliQrUrl.value)
  qrStatus.value = '已尝试拉起哔哩哔哩，请在 App 中点击「确认登录」'
}

async function biliPwdLogin(): Promise<void> {
  if (pwdBusy.value) return
  pwdErr.value = ''
  if (!pwdUser.value.trim() || !pwdPass.value) {
    pwdErr.value = '请输入账号与密码'
    return
  }
  pwdBusy.value = true
  try {
    await call('bili:passwordLogin', { username: pwdUser.value.trim(), password: pwdPass.value })
    bili.value = await call('bili:status')
    ui.toast('视频源账号登录成功', 'success')
    pwdUser.value = ''
    pwdPass.value = ''
    qrOpen.value = false
  } catch (e: any) {
    pwdErr.value = e?.message || '登录失败'
  } finally {
    pwdBusy.value = false
  }
}

async function biliCkLogin(): Promise<void> {
  if (ckBusy.value) return
  ckErr.value = ''
  if (!ckText.value.trim()) {
    ckErr.value = '请粘贴 Cookie 内容'
    return
  }
  ckBusy.value = true
  try {
    await call('bili:cookieLogin', { cookie: ckText.value.trim() })
    bili.value = await call('bili:status')
    ui.toast('视频源账号登录成功', 'success')
    ckText.value = ''
    qrOpen.value = false
  } catch (e: any) {
    ckErr.value = e?.message || '登录失败'
  } finally {
    ckBusy.value = false
  }
}

async function poll(): Promise<void> {
  if (!qrKey.value) return
  try {
    const r = await call<{ ok: boolean; status: string; message?: string }>('bili:poll', { key: qrKey.value })
    if (r.status) qrStatus.value = r.message || r.status
    if (r.ok) {
      stopPoll()
      bili.value = await call('bili:status')
      ui.toast('视频源账号登录成功', 'success')
      setTimeout(() => (qrOpen.value = false), 700)
    } else if (r.status === 'expired' || r.status === 'error') {
      stopPoll()
    }
  } catch (e: any) {
    qrStatus.value = e?.message || '轮询失败'
    stopPoll()
  }
}

function stopPoll(): void {
  if (qrTimer) window.clearInterval(qrTimer)
  qrTimer = null
}

async function biliLogout(): Promise<void> {
  bili.value = await call('bili:logout').catch(() => ({ loggedIn: false }))
  ui.toast('已退出视频源账号', 'info')
}

async function pickDirs(): Promise<void> {
  await library.pickAndScan()
  await loadMeta()
}

onMounted(async () => {
  await Promise.all([loadSources(), loadMeta(), loadPlugins(), loadSubs()])
})

watch(qrOpen, v => {
  if (!v) stopPoll()
})

onBeforeUnmount(stopPoll)
</script>

<template>
  <div class="page settings">
    <header class="head">
      <div>
        <h1>设置</h1>
        <p>所有配置保存在本地，修改后立即生效</p>
      </div>
      <div class="search-wrap">
        <div class="search-box">
          <Icon name="search" :size="15" />
          <input v-model="q" placeholder="搜索设置项，如「弹幕」「代理」" />
          <button v-if="q" class="search-clear" @click="q = ''"><Icon name="close" :size="13" /></button>
        </div>
        <div v-if="q" class="search-pop">
          <button v-for="r in searchResults" :key="r.key as string" class="search-item" @click="jumpTo(r)">
            <b>{{ r.label }}</b>
            <span>{{ catLabel(r.cat) }}</span>
          </button>
          <div v-if="!searchResults.length" class="search-empty">没有匹配的设置项</div>
        </div>
      </div>
    </header>

    <!-- 移动端：分类列表页（一级） -->
    <div v-if="isMobileSettings && !mobileCat" class="m-cats">
      <button v-for="c in cats" :key="c.key" class="m-cat" @click="mobileCat = c.key; cat = c.key">
        <span class="m-cat-icon"><Icon :name="c.icon" :size="18" /></span>
        <span class="m-cat-label">{{ c.label }}</span>
        <Icon name="chevron-right" :size="15" class="m-cat-arrow" />
      </button>
    </div>

    <!-- 移动端：分类整页面板（二级） -->
    <template v-if="isMobileSettings && mobileCat">
      <div class="m-back-row">
        <button class="m-back" @click="mobileCat = ''">
          <Icon name="chevron-left" :size="18" />设置
        </button>
        <b class="m-back-title">{{ catLabel(String(mobileCat)) }}</b>
      </div>
    </template>

    <div v-show="!isMobileSettings || !!mobileCat" class="layout">
      <aside v-if="!isMobileSettings" class="cats">
        <button v-for="c in cats" :key="c.key" class="cat" :class="{ active: cat === c.key }" @click="cat = c.key">
          <Icon :name="c.icon" :size="16" />
          <span>{{ c.label }}</span>
        </button>
      </aside>

      <div class="panel">
        <!-- 外观 -->
        <section v-if="cat === 'appearance' || (isMobileSettings && mobileCat === 'appearance')">
          <h2>外观与主题</h2>
          <p class="hint">主题模式、强调色、皮肤与壁纸集中在这里；播放页背景与唱片转速也归本区。</p>
          <div class="row">
            <div class="label"><b>主题模式</b><span>深色适合夜间长时间听歌</span></div>
            <div class="seg">
              <button :class="{ on: setting.theme === 'dark' }" @click="patch({ theme: 'dark' })"><Icon name="moon" :size="14" />深色</button>
              <button :class="{ on: setting.theme === 'light' }" @click="patch({ theme: 'light' })"><Icon name="sun" :size="14" />浅色</button>
              <button :class="{ on: setting.theme === 'auto' }" @click="patch({ theme: 'auto' })"><Icon name="monitor" :size="14" />跟随系统</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>强调色</b><span>色谱选择，应用后所有页面即时更新</span><input v-model.number="themeHue" type="range" min="0" max="360" step="1" class="hue-slider" @change="pickHue(themeHue)" /></div>
            <div class="accent-wrap">
              <div class="swatches">
                <button
                  v-for="c in ACCENTS"
                  :key="c"
                  class="swatch"
                  :class="{ on: setting.accent.toLowerCase() === c }"
                  :style="{ background: c }"
                  :aria-label="`选择强调色 ${c}`"
                  @click="patch({ accentMode: 'custom', accent: c })"
                />
                <input
                  type="color"
                  class="color-input"
                  :value="setting.accent"
                  aria-label="自定义强调色"
                  @input="patch({ accentMode: 'custom', accent: ($event.target as HTMLInputElement).value })"
                />
              </div>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>界面动画</b><span>关闭后减少过渡与动效，降低 GPU 占用</span></div>
            <Toggle :model-value="setting.animations" @update:model-value="v => patch({ animations: v })" />
          </div>

          <div class="row">
            <div class="label"><b>粒子舞台</b><span>播放页粒子特效，低配设备建议关闭</span></div>
            <Toggle :model-value="setting.particle" @update:model-value="v => patch({ particle: v })" />
          </div>

          <div class="row">
            <div class="label"><b>手机粒子</b><span>手机端默认关闭，开启后限 50 粒子省电档</span></div>
            <Toggle :model-value="particlePhone" @update:model-value="v => setParticlePhone(v)" />
          </div>

 <!--车机模式退出入口（识别为车机后此前不可逆） -->
          <div v-if="carMode" class="row">
            <div class="label"><b>车机模式</b><span>当前按车机布局渲染（琥珀黄大字大按钮）</span></div>
            <button class="btn" @click="exitCarMode"><Icon name="monitor" :size="14" />退出车机模式</button>
          </div>

          <div class="row">
            <div class="label"><b>列表密度</b><span>影响歌曲列表行高与一屏可见数量</span></div>
            <div class="seg">
              <button :class="{ on: setting.listDensity === 'compact' }" @click="patch({ listDensity: 'compact' })">紧凑</button>
              <button :class="{ on: setting.listDensity === 'standard' }" @click="patch({ listDensity: 'standard' })">标准</button>
              <button :class="{ on: setting.listDensity === 'relaxed' }" @click="patch({ listDensity: 'relaxed' })">宽松</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>播放页背景</b><span>封面魔法色渐变 / 歌词墙 / 粒子 / 舞台频谱（第十八轮修订）</span></div>
            <div class="seg">
              <button :class="{ on: bgMode === 'cover' }" @click="patch({ playerBg: 'cover' })">封面</button>
              <button :class="{ on: bgMode === 'lyric-wall' }" @click="patch({ playerBg: 'lyric-wall' })">歌词墙</button>
              <button :class="{ on: bgMode === 'particle' }" @click="patch({ playerBg: 'particle' })">粒子</button>
              <button :class="{ on: bgMode === 'spectrum' }" @click="patch({ playerBg: 'spectrum' })">舞台</button>
              <button :class="{ on: bgMode === 'gradient' }" @click="patch({ playerBg: 'gradient' })">纯渐变</button>
              <button :class="{ on: bgMode === 'solid' }" @click="patch({ playerBg: 'solid' })">纯色</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>唱片转速</b><span>Q音口径：24 / 16 / 8 秒一圈，默认 16</span></div>
            <div class="seg">
              <button :class="{ on: spinSec === 24 }" @click="patch({ playerSpinSec: 24 })">24s</button>
              <button :class="{ on: spinSec === 16 }" @click="patch({ playerSpinSec: 16 })">16s</button>
              <button :class="{ on: spinSec === 8 }" @click="patch({ playerSpinSec: 8 })">8s</button>
            </div>
          </div>
        </section>


 <!-- 主题 · 皮肤 · 壁纸（并入「外观与主题」分区， -->
        <section v-if="cat === 'appearance' || (isMobileSettings && mobileCat === 'appearance')">
          <h2>皮肤 · 主题包 · 壁纸</h2>
          <p class="hint">预置皮肤 / 主题包（主题市场）/ 播放页壁纸（本地库 + 开源壁纸）。</p>

          <div class="row">
            <div class="label"><b>主题市场</b><span>独立分支（Star-Wish-Theme-Library）：在线主题包一键安装；开源壁纸在「壁纸」Tab</span></div>
            <button class="btn sm" @click="openThemeMarket"><Icon name="download" :size="14" />进入</button>
          </div>

          <div class="seg" style="margin-bottom: 14px">
            <button :class="{ on: themeTab === 'theme' }" @click="themeTab = 'theme'">主题</button>
            <button :class="{ on: themeTab === 'wallpaper' }" @click="themeTab = 'wallpaper'">壁纸</button>
          </div>

          <!-- ==== 主题 Tab ==== -->
          <template v-if="themeTab === 'theme'">
            <div class="row col">
              <div class="label"><b>预置皮肤</b><span>本地内置 5 套，无网络可切换</span></div>
              <div class="theme-grid">
                <button
                  v-for="t in themes.filter(x => x.kind === 'preset')"
                  :key="t.id"
                  class="theme-chip"
                  :class="{ on: activeThemeId === t.id }"
                  @click="useTheme(t.id)"
                >
                  <span class="tc" :style="{ background: `linear-gradient(135deg, ${t.colors.primary}, ${t.colors.accent})` }" />
                  <span class="tn">{{ t.name }}</span>
                </button>
              </div>
            </div>

            <!-- 在线主题库（独立分支 Star-Wish-Theme-Library，与插件市场分离） -->
            <div class="row col">
              <div class="label">
                <b>在线主题库</b>
                <span>主题市场独立分支：在线浏览主题包并一键安装<template v-if="themeMarketError"> · {{ themeMarketError }}</template></span>
                <button class="btn sm ghost" style="margin-left: auto" :disabled="themeMarketLoading" @click="loadThemeMarket(true)">
                  <Icon name="refresh" :size="14" />刷新
                </button>
              </div>
              <div v-if="themeMarketLoading" class="hint">正在拉取主题库…</div>
              <div v-else-if="!themeMarketItems.length" class="hint">主题库暂未上架，敬请期待（可先使用预置皮肤或本地导入主题包）</div>
              <div v-else class="theme-grid">
                <div v-for="m in themeMarketItems" :key="m.url" class="theme-chip mk-theme-item">
                  <span class="tc" :style="{ background: `linear-gradient(135deg, ${m.name.length % 2 ? '#a78bfa' : '#f472b6'}, ${m.name.length % 3 ? '#60a5fa' : '#34d399'})` }" />
                  <span class="tn">{{ m.name }}<template v-if="m.version"> v{{ m.version }}</template></span>
                  <span class="mk-theme-acts">
                    <button class="btn sm" :class="{ ghost: m.installed && !m.canUpdate }" :disabled="m.installed && !m.canUpdate" @click="m.installed && !m.canUpdate ? undefined : installThemeFromMarket(m)">
                      {{ m.installed ? (m.canUpdate ? '更新' : '已装') : '安装' }}
                    </button>
                    <button v-if="m.installed" class="btn sm ghost" @click="uninstallThemeFromMarket(m)">卸载</button>
                  </span>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="label"><b>主题色</b><span>主色/强调色 12 色预设 + 自定义取色（即时生效）</span></div>
              <div class="swatches">
                <button
                  v-for="c in THEME_SWATCHES"
                  :key="c"
                  class="sw"
                  :class="{ on: (setting.accent || '').toLowerCase() === c }"
                  :style="{ background: c }"
                  @click="pickSwatch(c)"
                />
              </div>
              <div class="hue-row">
                <input v-model.number="themeHue" type="range" min="0" max="360" step="1" class="hue-slider" @change="pickHue(themeHue)" />
                <span class="hue-val">{{ themeHue }}°</span>
              </div>
            </div>

            <div class="row col">
              <div class="label">
                <b>主题包</b>
                <span>社区主题包（皮肤商店），JSON ≤256KB 白名单校验；卸载恢复默认</span>
              </div>
              <div class="inline" style="flex-wrap: wrap">
                <button class="btn sm" @click="themeFileInput?.click()"><Icon name="folder-open" :size="14" />导入 JSON</button>
              </div>
              <div class="theme-pkgs">
                <div v-for="t in themes.filter(x => x.kind !== 'preset')" :key="t.id" class="pkg-row">
                  <span class="tc sm" :style="{ background: `linear-gradient(135deg, ${t.colors.primary || '#666'}, ${t.colors.accent || '#333'})` }" />
                  <span class="pkg-meta">
                    <b>{{ t.name }}</b>
                    <span>{{ t.author }} · v{{ t.version }} · {{ t.kind }}</span>
                  </span>
                  <span class="pkg-acts">
                    <button class="btn sm" @click="useTheme(t.id)">应用</button>
                    <button class="btn sm ghost" @click="removeThemePkg(t.id)">卸载</button>
                  </span>
                </div>
                <p v-if="!themes.some(x => x.kind !== 'preset')" class="hint">暂无已装主题包（可从主题市场或本地 JSON 导入）</p>
              </div>
            </div>
            <input ref="themeFileInput" type="file" accept=".json,application/json" class="hidden-file" @change="onThemeFile" />
          </template>

          <!-- ==== 壁纸 Tab ==== -->
          <template v-else>
            <div class="row col">
              <div class="label">
                <b>本地壁纸库</b>
                <span>点击应用为播放页背景；蓝框为当前壁纸</span>
              </div>
              <div class="inline">
                <button class="btn sm" @click="addLocalWallpaper"><Icon name="plus" :size="14" />添加壁纸</button>
              </div>
              <div class="wall-grid">
                <button
                  v-for="w in walls"
                  :key="w.id"
                  class="wall-item"
                  :class="{ on: setting.playerBg === 'wallpaper' && setting.wallpaperId === w.id }"
                  @click="useWallpaper(w.id)"
                >
                  <img :src="w.url" :alt="w.name" loading="lazy" />
                  <span class="wall-name">{{ w.name }}</span>
                  <span class="wall-del" title="删除" @click.stop="removeWall(w.id)"><Icon name="trash" :size="13" /></span>
                </button>
              </div>
              <p v-if="!walls.length" class="hint">本地库为空：可从下方开源壁纸下载，或本地导入图片</p>
            </div>

            <div class="row col">
              <div class="label">
                <b>开源壁纸</b>
                <span>无版权可商用源（Pixabay/Pexels 需在下方填 key；默认走无 key 兜底源）；仅作播放页背景</span>
              </div>
              <div class="inline">
                <input
                  v-model="onlineQInput"
                  class="input"
                  style="max-width: 260px"
                  placeholder="搜索壁纸（过滤，清空回默认列表）"
                  @input="onOnlineSearchInput"
                />
                <button class="btn sm" :disabled="onlineLoading" @click="loadOnlineWalls(true)"><Icon name="refresh" :size="14" />刷新</button>
              </div>
              <p v-if="onlineSource" class="hint">当前源：{{ onlineSource }}{{ onlineQ ? ` · 搜索“${onlineQ}”` : ' · 默认列表' }}</p>
              <div class="wall-grid">
                <div v-if="onlineLoading && !onlineWalls.length" v-for="i in 8" :key="'sk' + i" class="sk wall-item" style="aspect-ratio: 16 / 10" />
                <button
                  v-for="w in onlineWalls"
                  :key="w.id"
                  class="wall-item"
                  @click="onlinePreview = w"
                >
                  <img :src="w.thumb" :alt="w.author || ''" loading="lazy" />
                  <span class="wall-name">{{ w.source }} · {{ w.w }}×{{ w.h }}</span>
                </button>
              </div>
              <p v-if="onlineFailed && !onlineWalls.length" class="hint" style="color: #f87171">
                开源壁纸源不可达（可填 key 或检查网络）；本地壁纸库仍可用（上方）。
              </p>
              <div v-if="onlineWalls.length || onlineLoading" class="lm-row">
                <button v-if="!onlineEnd" class="btn sm" :disabled="onlineLoading" @click="loadOnlineWalls()">
                  {{ onlineLoading ? '加载中…' : '加载更多' }}
                </button>
                <span v-else class="hint">没有更多了</span>
              </div>
            </div>

            <div class="row col">
              <div class="label"><b>壁纸源 API Key（可选）</b><span>Pixabay/Pexels 官方免费 key；不填则走无 key 兜底源；key 仅存本地</span></div>
              <div class="inline" style="flex-wrap: wrap">
                <input
                  class="input"
                  style="max-width: 240px"
                  placeholder="Pixabay key"
                  :value="setting.pixabayKey"
                  @change="patch({ pixabayKey: ($event.target as HTMLInputElement).value.trim() })"
                />
                <input
                  class="input"
                  style="max-width: 240px"
                  placeholder="Pexels key"
                  :value="setting.pexelsKey"
                  @change="patch({ pexelsKey: ($event.target as HTMLInputElement).value.trim() })"
                />
              </div>
            </div>
            <div class="row">
              <div class="label"><b>壁纸缓存</b><span>{{ (wallCache.bytes / 1024 / 1024).toFixed(1) }} MB · {{ wallCache.files }} 个文件（≤50 张/500MB/30 天 LRU）</span></div>
              <button class="btn sm ghost" @click="clearWallCache">清理缓存</button>
            </div>
          </template>
        </section>

        <!-- 视频与弹幕 -->
        <section v-else-if="cat === 'video' || (isMobileSettings && mobileCat === 'video')">
          <h2>视频与弹幕</h2>
          <p class="hint">MV / 视频播放器的默认行为。弹幕来自视频源，关闭后不影响视频播放。</p>

          <div class="row">
            <div class="label"><b>默认画质</b><span>自动会按网络情况选择</span></div>
            <select
              class="select"
              :value="String(setting.mvQuality)"
              @change="patch({ mvQuality: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option value="0">自动</option>
              <option value="80">1080P</option>
              <option value="64">720P</option>
              <option value="32">480P</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>记忆播放进度</b><span>下次进入同一视频时提示继续播放</span></div>
            <Toggle :model-value="setting.mvRememberProgress" @update:model-value="v => patch({ mvRememberProgress: v })" />
          </div>

          <div class="row">
            <div class="label"><b>自动连播下一集</b><span>多分 P 视频播完自动切换</span></div>
            <Toggle :model-value="setting.mvAutoNext" @update:model-value="v => patch({ mvAutoNext: v })" />
          </div>

          <div class="row">
            <div class="label"><b>启用弹幕</b><span>在视频上叠加弹幕层</span></div>
            <Toggle :model-value="setting.danmakuEnabled" @update:model-value="v => patch({ danmakuEnabled: v })" />
          </div>

          <div class="row">
            <div class="label"><b>弹幕透明度</b><span>{{ Math.round(setting.danmakuOpacity * 100) }}%</span></div>
            <Slider
              :model-value="setting.danmakuOpacity * 100"
              :max="100"
              :step="1"
              :disabled="!setting.danmakuEnabled"
              @update:model-value="v => patch({ danmakuOpacity: v / 100 })"
            />
          </div>

          <div class="row">
            <div class="label"><b>弹幕字号</b><span>影响弹幕密度</span></div>
            <div class="seg">
              <button :class="{ on: setting.danmakuFontSize === 'small' }" @click="patch({ danmakuFontSize: 'small' })">小</button>
              <button :class="{ on: setting.danmakuFontSize === 'medium' }" @click="patch({ danmakuFontSize: 'medium' })">中</button>
              <button :class="{ on: setting.danmakuFontSize === 'large' }" @click="patch({ danmakuFontSize: 'large' })">大</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>弹幕速度</b><span>滚动弹幕的快慢</span></div>
            <div class="seg">
              <button :class="{ on: setting.danmakuSpeed === 'slow' }" @click="patch({ danmakuSpeed: 'slow' })">慢</button>
              <button :class="{ on: setting.danmakuSpeed === 'normal' }" @click="patch({ danmakuSpeed: 'normal' })">中</button>
              <button :class="{ on: setting.danmakuSpeed === 'fast' }" @click="patch({ danmakuSpeed: 'fast' })">快</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>显示区域</b><span>弹幕占画面的高度</span></div>
            <div class="seg">
              <button :class="{ on: setting.danmakuArea === 'quarter' }" @click="patch({ danmakuArea: 'quarter' })">1/4</button>
              <button :class="{ on: setting.danmakuArea === 'half' }" @click="patch({ danmakuArea: 'half' })">半屏</button>
              <button :class="{ on: setting.danmakuArea === 'full' }" @click="patch({ danmakuArea: 'full' })">全屏</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>防挡字幕</b><span>底部区域不投放滚动弹幕</span></div>
            <Toggle :model-value="setting.danmakuAntiSubtitle" @update:model-value="v => patch({ danmakuAntiSubtitle: v })" />
          </div>

          <div class="row col">
            <div class="label"><b>屏蔽词</b><span>每行一个，包含该词的弹幕不显示</span></div>
            <textarea
              class="textarea"
              rows="4"
              :value="setting.danmakuBlockWords"
              placeholder="例如：\n前排\n签到"
              @change="patch({ danmakuBlockWords: ($event.target as HTMLTextAreaElement).value })"
            />
          </div>
        </section>

        <!-- 下载 -->
        <section v-else-if="cat === 'download' || (isMobileSettings && mobileCat === 'download')">
          <h2>下载</h2>
          <p class="hint">在歌曲列表右键选择「下载」，文件保存到下方目录，不参与缓存清理。</p>

          <div class="row">
            <div class="label"><b>下载目录</b><span class="path">{{ download.dir || '默认目录（下载/StarWish）' }}</span></div>
            <div class="inline">
              <button class="btn sm" @click="changeDownloadDir"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openDownloadDir"><Icon name="external" :size="14" />打开</button>
              <button v-if="setting.downloadDir" class="btn sm ghost" @click="resetDownloadDir">恢复默认</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>下载音质</b><span>跟随音质则与播放音质一致</span></div>
            <select
              class="select"
              :value="String(setting.downloadQuality)"
              @change="patch({ downloadQuality: ($event.target as HTMLSelectElement).value })"
            >
              <option value="">跟随全局音质</option>
              <option value="128k">标准 128K</option>
              <option value="320k">高品质 320K</option>
              <option value="flac">无损 FLAC</option>
              <option value="flac24bit">Hi-Res 24bit</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>同时下载歌词</b><span>保存与歌曲同名的 .lrc 文件</span></div>
            <Toggle :model-value="setting.downloadLrc" @update:model-value="v => patch({ downloadLrc: v })" />
          </div>

          <div class="row">
            <div class="label"><b>同时下载任务数</b><span>{{ setting.downloadConcurrency }} 个 · 音源多为第三方，并发过高可能被限流</span></div>
            <Slider
              :model-value="setting.downloadConcurrency"
              :min="1"
              :max="4"
              :step="1"
              @update:model-value="v => patch({ downloadConcurrency: v })"
            />
          </div>

          <div class="row">
            <div class="label"><b>下载管理</b><span>{{ download.tasks.length ? `${download.tasks.length} 条记录 · ${download.runningCount} 个进行中` : '暂无下载记录' }}</span></div>
            <button class="btn sm" @click="router.push('/downloads')"><Icon name="download" :size="14" />打开下载管理</button>
          </div>
        </section>

        <!-- 播放 -->
        <section v-else-if="cat === 'playback' || (isMobileSettings && mobileCat === 'playback')">
          <h2>播放</h2>
          <div class="row">
            <div class="label"><b>播放倍速</b><span>变速时保留音调，不产生「花栗鼠」效果</span></div>
            <select
              class="select"
              :value="String(setting.playbackRate)"
              @change="patch({ playbackRate: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option value="0.5">0.5×</option>
              <option value="0.75">0.75×</option>
              <option value="1">1.0×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2.0×</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>睡眠定时</b><span>到点自动暂停，适合睡前听歌</span></div>
            <select
              class="select"
              :value="String(setting.sleepTimerMin)"
              @change="setSleep(Number(($event.target as HTMLSelectElement).value))"
            >
              <option value="0">关闭</option>
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="45">45 分钟</option>
              <option value="60">60 分钟</option>
              <option value="90">90 分钟</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>默认音质</b><span>优先请求高音质，取链失败会自动降级</span></div>
            <select class="select" :value="setting.quality" @change="patch({ quality: ($event.target as HTMLSelectElement).value as any })">
              <option v-for="q in qualityOptions" :key="q.value" :value="q.value">{{ q.label }}</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>自动换源</b><span>当前音源取链失败时，自动在其他平台寻找同名歌曲</span></div>
            <Toggle :model-value="setting.autoSwitchSource" @update:model-value="v => patch({ autoSwitchSource: v })" />
          </div>

          <div class="row">
            <div class="label"><b>播放失败自动跳过</b><span>连续失败 3 首后暂停并提示</span></div>
            <Toggle :model-value="setting.skipOnError" @update:model-value="v => patch({ skipOnError: v })" />
          </div>

          <div class="row">
            <div class="label"><b>切歌淡入淡出</b><span>避免爆音，过渡更自然</span></div>
            <div class="inline">
              <Toggle :model-value="setting.crossfade" @update:model-value="v => patch({ crossfade: v })" />
              <span class="val">{{ setting.fadeMs }} ms</span>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>过渡时长</b><span>淡入淡出的时间</span></div>
            <Slider
              class="row-slider"
              :model-value="setting.fadeMs"
              :max="1500"
              :step="50"
              @change="v => patch({ fadeMs: v })"
            />
          </div>

          <div class="row">
            <div class="label"><b>播放速度</b><span>0.75× ~ 2×，仅影响当前播放</span></div>
            <div class="seg">
              <button
                v-for="r in [0.75, 1, 1.25, 1.5, 2]"
                :key="r"
                :class="{ on: (player.state.rate || 1) === r }"
                @click="player.setRate(r)"
              >
                {{ r }}×
              </button>
            </div>
          </div>

          <div class="row">
            <div class="label">
              <b>定时关闭</b>
              <span>{{ player.sleepUntil ? '将在设定时间自动暂停播放' : '到点自动暂停，适合睡前听歌' }}</span>
            </div>
            <div class="seg">
              <button :class="{ on: !player.sleepUntil }" @click="player.setSleep(0)">关闭</button>
              <button v-for="m in [15, 30, 60, 90]" :key="m" @click="player.setSleep(m)">{{ m }} 分钟</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>记住播放进度</b><span>下次启动恢复到上次播放位置</span></div>
            <Toggle :model-value="setting.rememberPosition" @update:model-value="v => patch({ rememberPosition: v })" />
          </div>
        </section>

        <!-- 歌词 -->
        <section v-else-if="cat === 'lyric' || (isMobileSettings && mobileCat === 'lyric')">
          <h2>歌词</h2>
          <div class="row">
            <div class="label"><b>桌面歌词</b><span>悬浮在桌面最上层，快捷键 Ctrl+Alt+L</span></div>
            <Toggle :model-value="setting.showDesktopLyric" @update:model-value="v => patch({ showDesktopLyric: v })" />
          </div>
          <div class="row">
            <div class="label"><b>锁定桌面歌词</b><span>锁定后鼠标穿透，不影响其他操作</span></div>
            <Toggle :model-value="setting.desktopLyricLock" @update:model-value="v => patch({ desktopLyricLock: v })" />
          </div>
          <div class="row">
            <div class="label"><b>歌词字号</b><span>播放页歌词基础字号</span></div>
            <div class="inline">
              <Slider class="row-slider" :model-value="setting.lyricFontSize" :max="44" :min="0" :step="1" @change="v => patch({ lyricFontSize: v })" />
              <span class="val">{{ setting.lyricFontSize }} px</span>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>歌词偏移校准</b><span>正值歌词提前，负值延后（±500ms）</span></div>
            <div class="inline">
              <Slider class="row-slider" :model-value="setting.lyricOffset" :min="-500" :max="500" :step="10" @change="v => patch({ lyricOffset: v })" />
              <span class="val">{{ setting.lyricOffset }} ms</span>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>当前歌词来源</b><span>当前歌曲实际使用的歌词来源</span></div>
            <span class="val">{{ lyricSourcesText }}</span>
          </div>
        </section>

        <!-- 音源 -->
        <section v-else-if="cat === 'sources' || (isMobileSettings && mobileCat === 'sources')">
          <div class="sec-head">
            <div>
              <h2>音源与插件</h2>
              <p class="desc">
                当前 {{ sources.length }} 个音源 · 可用 {{ sources.filter(s => !s.loadError && s.enabled).length }} 个 ·
                内置 {{ sources.filter(s => s.builtin).length }} 个
              </p>
            </div>
            <div class="head-btns">
              <button class="btn sm ghost" :disabled="restoring" @click="restoreSources">
                <Icon name="refresh" :size="14" />恢复内置音源
              </button>
              <button class="btn primary sm" @click="replaceTarget = null; importOpen = true"><Icon name="plus" :size="14" />导入音源</button>
            </div>
          </div>

          <div class="bili-card">
            <div class="bili-left">
              <div class="bili-logo"><Icon name="video" :size="19" /></div>
              <div>
                <b>视频音源</b>
                <p>{{ bili.loggedIn ? `已登录：${bili.uname || bili.mid}` : '未登录 · 仅可播放低清晰度，登录后解锁更高清晰度' }}</p>
              </div>
            </div>
            <div class="bili-actions">
              <button v-if="!bili.loggedIn" class="btn sm" @click="startBiliLogin"><Icon name="qr" :size="14" />扫码登录</button>
              <button v-else class="btn sm ghost" @click="biliLogout"><Icon name="logout" :size="14" />退出登录</button>
            </div>
          </div>

          <div v-if="sourcesLoading" class="src-list">
            <div v-for="i in 4" :key="i" class="sk" style="height: 62px; border-radius: 10px; margin-bottom: 8px" />
          </div>

          <div v-else class="src-list">
            <div v-for="s in sources" :key="s.file" class="src" :class="{ off: !s.enabled, bad: s.loadError }">
              <div class="src-main">
                <div class="src-title">
                  <b>{{ s.file.toLowerCase().includes('bilibili') ? '视频音源' : s.name }}</b>
                  <span v-if="s.version" class="src-ver">v{{ s.version }}</span>
                  <span v-if="s.builtin" class="src-tag">内置</span>
                  <span v-if="s.loadError" class="src-tag err">加载失败</span>
                </div>
                <div class="src-platforms">
                  <span v-for="p in s.platforms.slice(0, 6)" :key="p.platform" class="pf">{{ platformLabel(p.platform) }}</span>
                  <span v-if="s.platforms.length > 6" class="pf">+{{ s.platforms.length - 6 }}</span>
                  <span v-if="!s.platforms.length" class="pf none">未声明平台</span>
                </div>
                <div v-if="s.loadError" class="src-err">{{ s.loadError }}</div>
              </div>
              <div class="src-actions">
                <button v-if="!s.builtin" class="icon-btn" title="更新替换" @click="updateSource(s)">
                  <Icon name="refresh" :size="15" />
                </button>
                <button class="icon-btn" title="查看源码" @click="viewCode(s)"><Icon name="edit" :size="15" /></button>
                <button class="icon-btn" title="移除" @click="deleteTarget = s"><Icon name="trash" :size="15" /></button>
                <Toggle :model-value="s.enabled" @update:model-value="() => toggleSource(s)" />
              </div>
            </div>
            <div v-if="!sources.length" class="empty" style="padding: 30px">
              <div class="empty-desc">没有找到音源脚本，请检查安装目录下的 sources 文件夹</div>
            </div>
          </div>

          <!-- 4.8 局域网同步：桌面作为主机 -->
          <div class="sec-head" style="margin-top: 30px">
            <div>
              <h2>局域网同步</h2>
              <p class="desc">同一 Wi-Fi 下手机/平板扫码或手输 IP 连接本机，同步收藏、最近播放与设置（LWW 合并，不同步音频文件）</p>
            </div>
          </div>
          <div class="set-block">
            <div class="row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
              <div class="label"><b>作为同步主机</b><span>{{ lanInfo.active ? `已开启 · 端口 ${lanInfo.port} · 配对码 ${lanInfo.pin}` : '未开启' }}</span></div>
              <button v-if="!lanInfo.active" class="btn sm" :disabled="lanBusy" @click="lanStart">{{ lanBusy ? '启动中…' : '开启' }}</button>
              <button v-else class="btn sm ghost" @click="lanStop">关闭</button>
            </div>
            <div v-if="lanInfo.active" class="label" style="margin-top: 8px">
              <span>本机地址：{{ lanInfo.ips.map(ip => `${ip}:${lanInfo.port}`).join('　') }}（手机端「设置 → 局域网同步」输入并填配对码 {{ lanInfo.pin }}）</span>
            </div>
            <div v-if="lanInfo.active && lanInfo.lastSyncAt" class="label" style="margin-top: 4px">
              <span>最近同步：{{ new Date(lanInfo.lastSyncAt).toLocaleString() }}</span>
            </div>
          </div>

 <!-- / ：自定义市场 URL 与 git 令牌 -->
          <div class="sec-head" style="margin-top: 30px">
            <div>
              <h2>源市场</h2>
              <p class="desc">默认指向官方插件库分支 manifest，可替换为自建清单；私有仓库可填访问令牌</p>
            </div>
          </div>
          <div class="set-block">
            <div class="field" style="margin-bottom: 10px">
              <label>自定义市场 URL（N29）</label>
              <input
                :value="setting.marketUrl"
                placeholder="https://example.com/market.json（留空使用官方源）"
                style="width: 100%"
                @change="patch({ marketUrl: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field">
              <label>git 令牌（N31，私有仓库 raw 下载）</label>
              <input
                :value="setting.gitToken"
                type="password"
                placeholder="ghp_…（仅保存在本机设置）"
                style="width: 100%"
                @change="patch({ gitToken: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>

          <!-- 插件库（MusicFree 协议） -->
          <div class="sec-head" style="margin-top: 30px">
            <div>
              <h2>插件库</h2>
              <p class="desc">
                兼容 MusicFree 插件协议 · 当前 {{ plugins.length }} 个 · 可用 {{ plugins.filter(p => !p.loadError && p.enabled).length }} 个
              </p>
            </div>
            <div class="head-btns">
              <button class="btn sm ghost" @click="loadMarket(false)"><Icon name="download" :size="14" />插件市场</button>
              <button class="btn sm ghost" @click="subOpen = true"><Icon name="refresh" :size="14" />订阅源</button>
              <button class="btn primary sm" @click="pluginImportOpen = true"><Icon name="plus" :size="14" />导入插件</button>
            </div>
          </div>

          <div v-if="pluginsLoading" class="src-list">
            <div v-for="i in 3" :key="i" class="sk" style="height: 62px; border-radius: 10px; margin-bottom: 8px" />
          </div>

          <div v-else class="src-list">
            <div v-for="p in plugins" :key="p.file" class="src" :class="{ off: !p.enabled, bad: p.loadError }">
              <div class="src-main">
                <div class="src-title">
                  <b>{{ p.name }}</b>
                  <span v-if="p.version" class="src-ver">v{{ p.version }}</span>
                  <span v-if="p.loadError" class="src-tag err">加载失败</span>
                </div>
                <div class="src-platforms">
                  <span v-for="t in p.searchTypes.slice(0, 6)" :key="t" class="pf">{{ pluginTypeLabel(t) }}</span>
                  <span v-if="!p.searchTypes.length" class="pf none">无搜索类型</span>
                </div>
                <div v-if="p.author || p.origin !== 'local'" class="src-plat">
                  <span v-if="p.author">作者 {{ p.author }}</span>
                  <span v-if="p.origin === 'url'">· 网址导入</span>
                  <span v-else-if="p.origin === 'subscribe'">· 订阅</span>
                </div>
                <div v-if="p.loadError" class="src-err">{{ p.loadError }}</div>
              </div>
              <div class="src-actions">
                <button
                  v-if="p.sourceUrl"
                  class="icon-btn"
                  title="重新下载并替换为最新版本"
                  :disabled="marketUpdating === p.file"
                  @click="updatePlugin(p)"
                >
                  <Icon name="refresh" :size="15" />
                </button>
                <button class="icon-btn" title="查看源码" @click="viewPluginCode(p)"><Icon name="edit" :size="15" /></button>
                <button class="icon-btn" title="移除" @click="pluginDeleteTarget = p"><Icon name="trash" :size="15" /></button>
                <Toggle :model-value="p.enabled" @update:model-value="() => togglePlugin(p)" />
              </div>
            </div>
            <div v-if="!plugins.length" class="empty" style="padding: 30px">
              <div class="empty-desc">暂无插件，点「插件市场」安装；也可从本地文件/网址导入，或用「订阅源」批量安装</div>
            </div>
          </div>

          <!-- 订阅源列表 -->
          <div v-if="subs.length" class="src-list" style="margin-top: 16px">
            <div v-for="s in subs" :key="s.url" class="src">
              <div class="src-main">
                <div class="src-title"><b>{{ s.name || s.url }}</b><span class="src-ver">{{ s.count || 0 }} 个</span></div>
                <div class="src-plat"><span>{{ s.url }}</span></div>
              </div>
              <div class="src-actions">
                <button class="icon-btn" title="移除订阅" @click="removeSub(s.url)"><Icon name="trash" :size="15" /></button>
              </div>
            </div>
          </div>
        </section>

        <!-- 本地音乐 -->
        <section v-else-if="cat === 'local' || (isMobileSettings && mobileCat === 'local')">
          <h2>本地音乐</h2>
          <div class="row">
            <div class="label"><b>音乐文件夹</b><span>支持 MP3 / FLAC / M4A / OGG / WAV / APE</span></div>
            <button class="btn sm" @click="pickDirs"><Icon name="folder-open" :size="14" />添加并扫描</button>
          </div>
          <div class="dir-list">
            <div v-for="d in setting.localDirs" :key="d" class="dir">
              <Icon name="folder" :size="14" />
              <span class="ellipsis">{{ d }}</span>
            </div>
            <div v-if="!setting.localDirs.length" class="dir-empty">还没有添加音乐文件夹</div>
          </div>
          <div class="row">
            <div class="label"><b>启动时自动扫描</b><span>打开应用后扫描已添加的文件夹</span></div>
            <Toggle :model-value="setting.scanOnStart" @update:model-value="v => patch({ scanOnStart: v })" />
          </div>
          <div class="row">
            <div class="label"><b>当前曲库</b><span>已解析并写入本地数据库</span></div>
            <span class="val">{{ library.localCount }} 首</span>
          </div>
        </section>

        <!-- 缓存 -->
        <section v-else-if="cat === 'cache' || (isMobileSettings && mobileCat === 'cache')">
          <h2>网络与缓存</h2>
          <div v-if="dataRestart" class="banner">
            <Icon name="info" :size="15" />
            <span>数据目录已切换到 <b>{{ dataRestart }}</b>，重启后生效。</span>
            <button class="btn sm" @click="restartApp">立即重启</button>
          </div>
          <div class="row">
            <div class="label"><b>缓存目录</b><span class="path">{{ cachePath }}</span></div>
            <div class="inline">
              <button class="btn sm" @click="changeCacheDir"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openCacheDir('cache')"><Icon name="external" :size="14" />打开</button>
              <button v-if="setting.cacheDir" class="btn sm ghost" @click="resetCacheDir">恢复默认</button>
            </div>
          </div>
          <div class="row">
            <div class="label">
              <b>封面缓存</b>
              <span class="path">{{ coverPath }}</span>
            </div>
            <div class="inline">
              <span class="val">{{ fmtBytes(cache.cover) }}</span>
              <button class="btn sm ghost" @click="changeSubDir('cover', '封面缓存')"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openCacheDir('cover')"><Icon name="external" :size="14" />打开</button>
              <button class="btn sm ghost" @click="clearCache('cover')"><Icon name="trash" :size="14" />清理</button>
            </div>
          </div>
          <div class="row">
            <div class="label">
              <b>媒体缓存</b>
              <span class="path">{{ mediaPath }}</span>
            </div>
            <div class="inline">
              <span class="val">{{ fmtBytes(cache.media) }}</span>
              <button class="btn sm ghost" @click="changeSubDir('media', '媒体缓存')"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openCacheDir('media')"><Icon name="external" :size="14" />打开</button>
              <button class="btn sm ghost" @click="clearCache('media')"><Icon name="trash" :size="14" />清理</button>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>全部缓存</b><span>共 {{ fmtBytes(cache.total) }}，清理不会影响收藏、歌单与本地曲库</span></div>
            <button class="btn sm" @click="clearCache('all')"><Icon name="trash" :size="14" />全部清理</button>
          </div>
          <div class="row">
            <div class="label">
              <b>数据目录</b>
              <span class="path">{{ dataPath }}</span>
              <span>数据库、设置、登录态与音源；更改后需重启</span>
            </div>
            <div class="inline">
              <button class="btn sm" :disabled="dataMoving" @click="changeDataDir"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openDataDir"><Icon name="external" :size="14" />打开</button>
              <button class="btn sm ghost" @click="clearDataJunk"><Icon name="trash" :size="14" />清理</button>
              <button v-if="setting.dataDir" class="btn sm ghost" :disabled="dataMoving" @click="resetDataDir">恢复默认</button>
            </div>
          </div>

          <div class="sec-head" style="margin-top: 30px">
            <h3>网络代理</h3>
            <p>作用于音源、封面、弹幕与备份的全部请求，修改后立即生效</p>
          </div>

          <div class="row">
            <div class="label"><b>使用代理</b><span>支持 http / socks5，例如 127.0.0.1:7890</span></div>
            <Toggle :model-value="setting.proxyEnabled" @update:model-value="v => patch({ proxyEnabled: v })" />
          </div>

          <div v-if="setting.proxyEnabled" class="row col">
            <div class="label"><b>代理地址</b><span>host:port 或 socks5://host:port</span></div>
            <input
              class="input"
              :value="setting.proxyUrl"
              placeholder="127.0.0.1:7890"
              @change="patch({ proxyUrl: ($event.target as HTMLInputElement).value.trim() })"
            />
          </div>

          <div class="sec-head" style="margin-top: 30px">
            <h3>WebDAV 备份</h3>
            <p>把歌单与收藏单向备份到你的 WebDAV 服务器（坚果云、Nextcloud、群晖等）。首版只上传，不下载、不合并。</p>
          </div>

          <div class="row">
            <div class="label"><b>启用 WebDAV</b><span>配置保存在本地，密码仅用于 Basic 认证</span></div>
            <Toggle :model-value="setting.webdavEnabled" @update:model-value="v => patch({ webdavEnabled: v })" />
          </div>

          <template v-if="setting.webdavEnabled">
            <div class="row col">
              <div class="label"><b>服务器地址</b><span>例如 https://dav.jianguoyun.com/dav</span></div>
              <input
                class="input"
                :value="setting.webdavUrl"
                placeholder="https://"
                @change="patch({ webdavUrl: ($event.target as HTMLInputElement).value.trim() })"
              />
            </div>
            <div class="row col">
              <div class="label"><b>用户名</b><span>多数服务使用邮箱或账号名</span></div>
              <input
                class="input"
                :value="setting.webdavUser"
                autocomplete="off"
                @change="patch({ webdavUser: ($event.target as HTMLInputElement).value.trim() })"
              />
            </div>
            <div class="row col">
              <div class="label"><b>密码 / 应用密码</b><span>坚果云等需要单独生成应用密码</span></div>
              <input
                class="input"
                type="password"
                :value="setting.webdavPass"
                autocomplete="new-password"
                @change="patch({ webdavPass: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="row col">
              <div class="label"><b>子目录</b><span>留空则上传到根目录，例如 StarWish</span></div>
              <input
                class="input"
                :value="setting.webdavPath"
                placeholder="StarWish"
                @change="patch({ webdavPath: ($event.target as HTMLInputElement).value.trim() })"
              />
            </div>
            <div class="row">
              <div class="label">
                <b>连接与上传</b>
                <span>
                  {{
                    webdavMsg ||
                    (setting.webdavLastSync
                      ? '上次同步：' + new Date(setting.webdavLastSync).toLocaleString()
                      : '尚未同步')
                  }}
                </span>
              </div>
              <div class="inline">
                <button class="btn sm" :disabled="webdavBusy" @click="testWebdav">测试连接</button>
                <button class="btn sm" :disabled="webdavBusy" @click="uploadWebdav">
                  {{ webdavBusy ? '处理中…' : '立即上传' }}
                </button>
              </div>
            </div>
          </template>
        </section>

        <!-- 快捷键 -->
        <section v-else-if="cat === 'shortcuts' || (isMobileSettings && mobileCat === 'shortcuts')">
          <h2>快捷键与系统</h2>
          <div class="row">
            <div class="label"><b>任务栏歌词</b><span>在任务栏上方显示当前一句歌词（macOS 为菜单栏）</span></div>
            <Toggle :model-value="setting.showTaskbarLyric" @update:model-value="v => patch({ showTaskbarLyric: v })" />
          </div>
          <div class="row">
            <div class="label"><b>开机自启动</b><span>登录系统后自动启动星河音乐</span></div>
            <Toggle :model-value="setting.autoLaunch" @update:model-value="v => patch({ autoLaunch: v })" />
          </div>
          <div class="row">
            <div class="label"><b>关闭时最小化到托盘</b><span>关闭窗口不退出，继续后台播放</span></div>
            <Toggle :model-value="setting.closeToTray" @update:model-value="v => patch({ closeToTray: v })" />
          </div>
          <div class="keys">
            <div class="key-row"><span>播放 / 暂停</span><kbd>Space</kbd></div>
            <div class="key-row"><span>播放 / 暂停（全局）</span><kbd>Ctrl + Alt + P</kbd></div>
            <div class="key-row"><span>上一首（全局）</span><kbd>Ctrl + Alt + ←</kbd></div>
            <div class="key-row"><span>下一首（全局）</span><kbd>Ctrl + Alt + →</kbd></div>
            <div class="key-row"><span>桌面歌词开关</span><kbd>Ctrl + Alt + L</kbd></div>
            <div class="key-row"><span>聚焦搜索</span><kbd>Ctrl + K</kbd></div>
            <div class="key-row"><span>媒体键</span><kbd>播放 / 上一首 / 下一首</kbd></div>
          </div>
        </section>

        <!-- 关于 -->
        <section v-else>
          <h2>关于星河音乐</h2>
          <div class="about">
            <div class="about-mark">星</div>
            <div>
              <h3>星河音乐 <span>StarWish Music</span></h3>
              <p>版本 {{ appInfo?.version || appVersion }} · Electron {{ appInfo?.electron || '-' }}</p>
              <p>Chrome {{ appInfo?.chrome || '-' }} · Node {{ appInfo?.node || '-' }}</p>
              <p class="muted">多音源聚合播放器，音源脚本可自由导入替换。所有音乐版权归各平台与版权方所有，仅供个人学习与试听。</p>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>本地数据库</b><span>歌曲 / 歌单 / 收藏 / 播放历史</span></div>
            <span class="val">{{ appInfo?.db?.songs || 0 }} 首 · {{ fmtBytes(appInfo?.db?.size || 0) }}</span>
          </div>
          <div class="row">
            <div class="label"><b>日志目录</b><span class="path">{{ logPath }}</span></div>
            <div class="inline">
              <button class="btn sm" @click="changeLogDir"><Icon name="folder-open" :size="14" />更改目录</button>
              <button class="btn sm ghost" @click="openDataDir"><Icon name="external" :size="14" />打开数据目录</button>
              <button v-if="setting.logDir" class="btn sm ghost" @click="resetLogDir">恢复默认</button>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>软件更新</b>
              <span v-if="updateInfo?.hasUpdate">发现新版本 v{{ updateInfo.version }}（当前 v{{ updateInfo.current }}）</span>
              <span v-else-if="updateInfo">当前 v{{ updateInfo.current }} 已是最新版本</span>
              <span v-else>检查是否有新版本可供下载</span>
              <span v-if="desktopProgress && desktopProgress.phase === 'downloading'" class="muted">
                正在下载更新包 {{ desktopProgress.percent }}%
              </span>
              <span v-else-if="desktopFilePath" class="muted">更新包已下载完成，可重启安装</span>
            </div>
            <div style="display:flex;gap:8px;flex:none;align-items:center">
              <button class="btn sm ghost" :disabled="updateChecking" @click="doCheckUpdate">
                <Icon name="refresh" :size="14" />{{ updateChecking ? '检查中…' : '检查更新' }}
              </button>
              <button v-if="updateInfo?.hasUpdate" class="btn sm" :disabled="desktopUpdating" @click="openUpdatePage">
                <Icon name="external" :size="14" />{{ desktopUpdating ? '下载中…' : '下载并安装' }}
              </button>
              <button v-if="desktopFilePath" class="btn sm" @click="applyDesktopUpdate">
                <Icon name="refresh" :size="14" />重启并安装
              </button>
              <button v-if="desktopFilePath" class="btn sm ghost" @click="revealDesktopUpdate">
                <Icon name="folder-open" :size="14" />打开所在文件夹
              </button>
            </div>
          </div>
        </section>

 <!-- 开源壁纸大图预览浮层（≤1280px）；置于分区链之外，避免打断 v-else-if 互斥链 -->
        <div v-if="onlinePreview" class="mask" @click.self="onlinePreview = null">
          <div class="panel small">
            <img :src="onlinePreview.thumb" style="width: 100%; border-radius: 10px; margin-bottom: 10px" alt="" />
            <header class="phead">
              <b>{{ onlinePreview.source }} · {{ onlinePreview.w }}×{{ onlinePreview.h }}</b>
              <button class="txt" @click="onlinePreview = null">关闭</button>
            </header>
            <button class="btn primary wide" :disabled="onlineBusy >= 2" @click="previewDownload">
              {{ onlineBusy >= 2 ? '下载中…' : '下载并应用为播放页背景' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 导入音源 -->
    <Modal
      v-model="importOpen"
      :title="replaceTarget ? `更新音源 · ${replaceTarget.name}` : '导入音源'"
      :width="520"
      @update:model-value="v => !v && (replaceTarget = null)"
    >
      <p class="modal-tip">
        {{
          replaceTarget
            ? '填入新版本链接或选择本地文件，将原地覆盖该音源（保留文件名与启用状态）。'
            : '支持 lx-music 协议 JS 音源，可从在线链接导入或选择本地文件。'
        }}
      </p>
      <label class="field-label">音源链接</label>
      <input v-model="importUrl" class="input" placeholder="https://example.com/source.js" spellcheck="false" @input="importText = ''" />
      <label class="field-label">或选择本地 JS 文件</label>
      <input type="file" accept=".js,text/javascript" class="file" @change="onFile" />
      <div v-if="importText" class="file-ok"><Icon name="check" :size="13" />已读取脚本（{{ (importText.length / 1024).toFixed(1) }} KB）</div>
      <div v-if="importError" class="err"><Icon name="info" :size="13" />{{ importError }}</div>
      <template #footer>
        <button class="btn ghost" @click="importOpen = false">取消</button>
        <button class="btn primary" :disabled="importing" @click="doImport">
          {{ importing ? '处理中…' : replaceTarget ? '更新替换' : '导入' }}
        </button>
      </template>
    </Modal>

    <!-- 查看源码 -->
    <Modal v-model="codeOpen" :title="`音源源码 · ${codeName}`" :width="760">
      <pre class="code">{{ codeText }}</pre>
    </Modal>

    <!-- 删除确认 -->
    <Modal :model-value="!!deleteTarget" title="移除音源" :width="400" @update:model-value="v => !v && (deleteTarget = null)">
      <p style="font-size: 13px; line-height: 1.8">
        确定移除音源「{{ deleteTarget?.name }}」吗？<br />
        <span style="color: var(--text-3)">
          {{ deleteTarget?.builtin ? '内置音源可随时通过「恢复内置音源」找回。' : '删除后需要重新导入才能恢复。' }}
        </span>
      </p>
      <template #footer>
        <button class="btn ghost" @click="deleteTarget = null">取消</button>
        <button class="btn primary" @click="doDelete">删除</button>
      </template>
    </Modal>

    <!-- 导入插件 -->
    <Modal v-model="pluginImportOpen" title="导入插件" :width="520">
      <div class="imp-tabs">
        <button :class="{ on: !pluginImportUrl }" @click="pluginImportUrl = ''">本地文件</button>
        <button :class="{ on: !!pluginImportUrl }" @click="pluginImportUrl = pluginImportUrl || 'https://'">网址导入</button>
      </div>
      <template v-if="!pluginImportUrl">
        <input type="file" accept=".js,.cjs,.txt" style="width: 100%; margin: 10px 0" @change="onPluginFile" />
        <p class="tip">支持 MusicFree 插件协议（.js / .cjs / .txt），本地文件直接读取内容后导入。</p>
      </template>
      <template v-else>
        <div class="field">
          <label>插件网址（.js 或 .txt）</label>
          <input v-model="pluginImportUrl" placeholder="https://example.com/plugin.js" style="width: 100%" />
        </div>
        <p class="tip">将从该网址下载插件源码并导入，下载失败请检查网络。</p>
      </template>
      <div v-if="pluginImportError" class="imp-err">{{ pluginImportError }}</div>
      <template #footer>
        <button class="btn ghost" @click="pluginImportOpen = false">取消</button>
        <button class="btn primary" :disabled="pluginImporting" @click="doImportPlugin">
          {{ pluginImporting ? '导入中...' : '导入' }}
        </button>
      </template>
    </Modal>

    <!-- 源市场（0.10 统一源市场：三类源 + 搜索 + kind Tab + 版本对比） -->
    <Modal v-model="marketOpen" title="插件与音源市场" width="min(900px, calc(100vw - 32px))" padding="16px 20px 18px">
      <div class="market-editor">
        <div class="market-editor-head">
          <div>
            <b>插件市场</b>
            <p class="tip">浏览、搜索和管理音源、插件与视频源。主题包和开源壁纸请前往「主题市场」。</p>
          </div>
          <button class="btn sm ghost" :disabled="marketLoading" @click="loadMarket(true)"><Icon name="refresh" :size="14" />刷新</button>
        </div>
        <label class="market-search-label" for="market-search">搜索市场</label>
        <input id="market-search" v-model="marketKeyword" class="market-search" type="search" placeholder="搜索名称、作者或描述…" />
        <div class="imp-tabs market-tabs" role="tablist" aria-label="市场类别">
          <button
            v-for="t in KIND_TABS"
            :key="t.key"
            :class="{ on: marketKind === t.key }"
            @click="marketKind = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <div v-if="marketLoading" class="src-list market-results">
          <div v-for="i in 3" :key="i" class="sk" style="height: 58px; border-radius: 10px; margin-bottom: 8px" />
        </div>
        <div v-else-if="marketError" class="imp-err market-results">{{ marketError }}</div>
        <div v-else class="src-list market-results">
          <div v-for="m in marketFiltered" :key="m.url" class="src" @click="marketDetailId = marketDetailId === m.id ? '' : m.id">
            <div class="src-main">
              <div class="src-title">
                <b>{{ m.name }}</b>
                <span v-if="m.version" class="src-ver">v{{ m.version }}</span>
                <span class="pf">{{ KIND_LABEL[m.kind] }}</span>
                <span v-if="m.canUpdate" class="pf upd">可更新</span>
              </div>
              <div v-if="m.author || m.description" class="src-plat">
                <span v-if="m.author">{{ m.author }}</span>
                <span v-if="m.description">· {{ m.description }}</span>
              </div>
              <div v-if="marketDetailId === m.id" class="src-detail">
                <p v-if="m.changelog">更新说明：{{ m.changelog }}</p>
                <p v-if="m.compat">最低应用版本：{{ m.compat }}</p>
                <p v-if="m.commitSha">版本：{{ m.commitSha.slice(0, 8) }}</p>
                <p class="src-url">{{ m.url }}</p>
              </div>
            </div>
            <div class="src-actions">
              <button class="btn sm" :disabled="marketUpdating === m.url || (!!m.installed && !m.canUpdate)" @click.stop="installFromMarket(m)">
                {{ marketUpdating === m.url ? '处理中…' : m.installed ? (m.canUpdate ? '更新' : '已安装') : '安装' }}
              </button>
              <button v-if="m.installed" class="btn sm ghost" :disabled="marketUpdating === m.url" @click.stop="uninstallFromMarket(m)">卸载</button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn ghost" @click="marketOpen = false">关闭</button>
      </template>
    </Modal>

    <!-- 订阅源 -->
    <Modal v-model="subOpen" title="插件订阅源" :width="520">
      <button class="btn sm ghost" style="width: 100%; margin-bottom: 10px" @click="subUrl = OFFICIAL_SUB_URL; subName = '星河官方插件库'">
        <Icon name="download" :size="14" />一键填入官方插件库
      </button>
      <div class="field">
        <label>订阅地址</label>
        <input v-model="subUrl" placeholder="https://example.com/plugins.json（JSON 数组或每行一个网址）" style="width: 100%" />
      </div>
      <div class="field">
        <label>备注名（可选）</label>
        <input v-model="subName" placeholder="我的插件源" style="width: 100%" />
      </div>
      <div v-if="subError" class="imp-err">{{ subError }}</div>
      <p class="tip">订阅地址可返回 JSON 数组（每项 { name, url }）或纯文本（每行一个插件网址）。订阅后可一键更新全部插件。</p>
      <template #footer>
        <button class="btn ghost" @click="subOpen = false">取消</button>
        <button class="btn primary" :disabled="subbing" @click="doSubscribe">
          {{ subbing ? '添加中...' : '添加订阅' }}
        </button>
      </template>
    </Modal>

    <!-- 移除插件确认 -->
    <Modal :model-value="!!pluginDeleteTarget" title="移除插件" :width="400" @update:model-value="v => !v && (pluginDeleteTarget = null)">
      <p style="font-size: 13px; line-height: 1.8">
        确定移除插件「{{ pluginDeleteTarget?.name }}」吗？<br />
        <span style="color: var(--text-3)">插件由你从插件市场 / 订阅源 / 本地导入安装，移除后需重新安装。</span>
      </p>
      <template #footer>
        <button class="btn ghost" @click="pluginDeleteTarget = null">取消</button>
        <button class="btn primary" @click="doDeletePlugin">删除</button>
      </template>
    </Modal>

    <!-- 视频源登录：扫码 / 账号密码 / Cookie 三种方式 -->
    <Modal v-model="qrOpen" title="视频源账号登录" :width="400">
      <div class="login-tabs">
        <button class="login-tab" :class="{ on: loginTab === 'qr' }" @click="switchLoginTab('qr')">
          <Icon name="qr" :size="14" />扫码登录
        </button>
        <button class="login-tab" :class="{ on: loginTab === 'pwd' }" @click="switchLoginTab('pwd')">
          <Icon name="lock" :size="14" />账号密码
        </button>
        <button class="login-tab" :class="{ on: loginTab === 'cookie' }" @click="switchLoginTab('cookie')">
          <Icon name="edit" :size="14" />Cookie
        </button>
      </div>

      <!-- 扫码 -->
      <div v-if="loginTab === 'qr'" class="qr-box">
        <img v-if="qrImg" :src="qrImg" class="qr" alt="视频源登录二维码" />
        <div v-else class="qr-placeholder"><Icon name="qr" :size="40" :stroke="1.2" /></div>
        <p class="qr-status">{{ qrStatus }}</p>
        <div class="qr-actions">
          <button v-if="isMobileApp" class="btn sm primary" @click="openBiliApp">
            <Icon name="external" :size="14" />拉起哔哩哔哩确认登录
          </button>
          <button class="btn sm ghost" @click="startBiliLogin"><Icon name="refresh" :size="14" />刷新二维码</button>
        </div>
        <p class="qr-tip">登录态仅保存在本机，用于获取更高清晰度的视频与音频流。</p>
      </div>

      <!-- 账号密码 -->
      <div v-else-if="loginTab === 'pwd'" class="login-form">
        <label class="lf-field">
          <span>账号（手机号 / 邮箱）</span>
          <input v-model="pwdUser" type="text" autocomplete="username" placeholder="B 站账号" />
        </label>
        <label class="lf-field">
          <span>密码</span>
          <input v-model="pwdPass" type="password" autocomplete="current-password" placeholder="密码" @keyup.enter="biliPwdLogin" />
        </label>
        <p v-if="pwdErr" class="login-err">{{ pwdErr }}</p>
        <button class="btn primary wide" :disabled="pwdBusy" @click="biliPwdLogin">
          {{ pwdBusy ? '正在登录…' : '登录' }}
        </button>
        <p class="lf-tip">若 B 站触发风控验证，会提示改用扫码或 Cookie 登录。</p>
      </div>

      <!-- Cookie -->
      <div v-else class="login-form">
        <label class="lf-field">
          <span>粘贴整串 Cookie 或仅 SESSDATA 值</span>
          <textarea
            v-model="ckText"
            rows="5"
            placeholder="SESSDATA=xxx; buvid3=xxx; …（或只粘贴 SESSDATA 的值）"
          ></textarea>
        </label>
        <p v-if="ckErr" class="login-err">{{ ckErr }}</p>
        <button class="btn primary wide" :disabled="ckBusy" @click="biliCkLogin">
          {{ ckBusy ? '正在校验…' : '校验并登录' }}
        </button>
        <p class="lf-tip">获取方式：浏览器登录 B 站 → F12 → 应用/存储 → Cookies → 复制 bilibili.com 的 Cookie。</p>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.settings {
  padding-top: 16px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
}

/* ---------------- 设置搜索 ---------------- */
.search-wrap {
  position: relative;
  width: 268px;
  flex: none;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text-3);
}
.search-box:focus-within {
  border-color: var(--accent);
}
.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.search-clear {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.search-clear:hover {
  background: var(--hover);
  color: var(--text);
}
.search-pop {
  position: absolute;
  top: 42px;
  right: 0;
  width: 320px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-2);
  box-shadow: var(--shadow);
  z-index: 30;
}
.search-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.search-item:hover {
  background: var(--hover);
}
.search-item span {
  font-size: 11.5px;
  color: var(--text-3);
}
.search-empty {
  padding: 16px;
  font-size: 12.5px;
  color: var(--text-3);
  text-align: center;
}
h1 {
  font-size: 27px;
  font-weight: 700;
}
.head p {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 26px;
  align-items: start;
}
.cats {
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 8px;
}
.cat {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
}
.cat:hover {
  background: var(--hover);
  color: var(--text);
}
.cat.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 550;
}
.panel {
  min-width: 0;
  max-width: 860px;
}
.panel h2 {
  font-size: 17px;
  font-weight: 650;
  margin-bottom: 8px;
}
.sec-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.head-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.path {
  word-break: break-all;
  font-size: 11px;
}
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  font-size: 12px;
  color: var(--text-2);
}
.banner span {
  flex: 1;
  word-break: break-all;
}
.desc {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 2px;
  border-bottom: 1px solid var(--line);
}

/* 竖向行：标签在上、控件在下（多行文本、壁纸网格等） */
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.hint {
  margin: -4px 0 12px;
  font-size: 12.5px;
  color: var(--text-3);
  line-height: 1.6;
}

/* ---------------- 恢复被误删的公共样式（壁纸样式已按 移除） ---------------- */
.textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}
.input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}
.input:focus,
.textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.row:last-child {
  border-bottom: none;
}
.label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.label b {
  font-size: 13px;
  font-weight: 550;
}
.label span {
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.5;
}
.seg {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: var(--panel);
  flex: none;
}
.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-2);
}
.seg button.on {
  background: var(--bg-2);
  color: var(--text);
  box-shadow: var(--shadow-sm);
  font-weight: 500;
}
.accent-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mini-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--panel);
  font-size: 11.5px;
  color: var(--text-2);
}
.mini-chip.on {
  background: var(--accent);
  color: #fff;
}
.swatches {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  transition: transform 0.15s;
}
.swatch:hover {
  transform: scale(1.15);
}
.swatch.on {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--panel-3);
}
.color-input {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}
.select {
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.inline {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.hidden-file {
  display: none;
}
.row-slider {
  width: 200px;
}
.val {
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  min-width: 60px;
  text-align: right;
}
.bili-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border-radius: 12px;
  background: linear-gradient(120deg, rgba(251, 114, 153, 0.1), rgba(120, 80, 255, 0.08));
  border: 1px solid var(--line);
  margin: 14px 0;
}
.bili-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.bili-logo {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, #ff4d6d, #a855f7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bili-left b {
  font-size: 13px;
}
.bili-left p {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
}
.src-list {
  margin-top: 6px;
}
.src {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 11px;
  background: var(--panel);
  border: 1px solid var(--line);
  margin-bottom: 8px;
  transition: opacity 0.18s;
}
.src.off {
  opacity: 0.55;
}
.src.bad {
  border-color: rgba(255, 107, 129, 0.35);
}
.src-main {
  min-width: 0;
}
.src-title {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.src-title b {
  font-size: 13px;
  font-weight: 550;
}
.src-ver {
  font-size: 10px;
  color: var(--text-3);
}
.src-tag {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--line-2);
  color: var(--text-3);
}
.src-tag.err {
  border-color: rgba(255, 107, 129, 0.5);
  color: #ff8b9c;
}
.src-platforms {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 5px;
}
.pf {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--panel-2);
  color: var(--text-2);
}
.pf.none {
  color: var(--text-3);
}
.src-err {
  margin-top: 5px;
  font-size: 10.5px;
  color: #ff8b9c;
}
.src-plat {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-3);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.market-editor {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-height: min(72vh, 760px);
}
.market-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  margin-bottom: 16px;
}
.market-editor-head > div { min-width: 0; }
.market-editor-head b { font-size: 18px; }
.market-editor-head .tip { margin: 6px 0 0; }
.market-search-label {
  margin-bottom: 7px;
  color: var(--text-2);
  font-size: 12px;
}
.market-search {
  flex: none;
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font-size: 15px;
}
.market-search:focus { border-color: var(--accent); outline: none; }
.src-detail {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: var(--text-2);
}
.src-detail p {
  margin: 2px 0;
}
.src-url {
  opacity: 0.6;
  word-break: break-all;
}
.pf.upd {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
}
.imp-tabs {
  display: flex;
  gap: 6px;
  margin: 6px 0;
}
.market-tabs {
  flex: none;
  margin: 12px 0 10px;
  padding: 5px;
  border-radius: 10px;
  background: var(--panel-2);
}
.imp-tabs button {
  flex: 1;
  min-height: 38px;
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.imp-tabs button.on {
  border-color: var(--accent);
  color: var(--accent);
}
.market-results {
  flex: 1;
  min-height: 160px;
  max-height: none;
  margin-top: 0 !important;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.field {
  margin: 8px 0;
}
.field label {
  display: block;
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 4px;
}
.tip {
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.6;
  margin-top: 8px;
}
.imp-err {
  margin-top: 8px;
  font-size: 11px;
  color: #ff8b9c;
  word-break: break-all;
}
.src-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.dir-list {
  margin: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dir {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border-radius: 9px;
  background: var(--panel);
  font-size: 11.5px;
  color: var(--text-2);
}
.dir-empty {
  font-size: 11.5px;
  color: var(--text-3);
  padding: 10px 2px;
}
.keys {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
kbd {
  font-family: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--text-2);
}
.about {
  display: flex;
  gap: 16px;
  padding: 16px 0 20px;
}
.about-mark {
  width: 62px;
  height: 62px;
  border-radius: 16px;
  background: linear-gradient(135deg, #2a1650, #ff4d6d);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  flex: none;
}
.about h3 {
  font-size: 16px;
  font-weight: 650;
}
.about h3 span {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-3);
  font-weight: 400;
  margin-left: 6px;
}
.about p {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 4px;
  line-height: 1.6;
}
.about .muted {
  max-width: 560px;
}
.modal-tip {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.7;
  margin-bottom: 14px;
}
.field-label {
  display: block;
  font-size: 11.5px;
  color: var(--text-3);
  margin: 10px 0 5px;
}
.input {
  width: 100%;
  height: 34px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  outline: none;
  font-size: 12.5px;
}
.input:focus {
  border-color: var(--accent);
}
.file {
  font-size: 11.5px;
  color: var(--text-2);
}
.file-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 11.5px;
  color: #4ade80;
}
.err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 11.5px;
  color: #ff8b9c;
}
.code {
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 14px;
  border-radius: 10px;
  background: var(--bg-3);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-2);
}
.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px 0 10px;
}
/* ---- 登录弹窗：三方式页签 ---- */
.login-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  padding: 4px;
  border-radius: 12px;
  background: var(--bg-3);
}
.login-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}
.login-tab.on {
  background: var(--panel);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
}
.qr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 0 10px;
}
.lf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lf-field span {
  font-size: 12px;
  color: var(--text-2);
}
.lf-field input,
.lf-field textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line, #262633);
  border-radius: 10px;
  background: var(--bg-3);
  color: var(--text);
  font-size: 13px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
}
.lf-field input:focus,
.lf-field textarea:focus {
  border-color: var(--accent);
}
.login-err {
  margin: 0;
  font-size: 12px;
  color: #ff8b9c;
  word-break: break-all;
}
.lf-tip {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
  opacity: 0.85;
}
.btn.wide {
  width: 100%;
  justify-content: center;
}
@media (max-width: 460px) {
  .qr-box :deep(.qr) {
    width: 180px;
    height: 180px;
  }
}
.qr {
  width: 220px;
  height: 220px;
  border-radius: 10px;
  background: #fff;
  padding: 6px;
}
.qr-placeholder {
  width: 220px;
  height: 220px;
  border-radius: 10px;
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.qr-status {
  font-size: 12.5px;
  color: var(--text-2);
}
.qr-tip {
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.6;
}

/* ---------------- 主题与壁纸（4.7+） ---------------- */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}
.theme-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.theme-chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(167, 139, 250, 0.08);
}
.tc {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.tc.sm {
  width: 26px;
  height: 26px;
  flex: none;
}
.tn {
  font-size: 12px;
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sw {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}
.sw.on {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--accent);
}
.hue-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.hue-slider {
  flex: 1;
  max-width: 320px;
  height: 10px;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(90deg, #f87171, #fbbf24, #34d399, #22d3ee, #a78bfa, #f472b6, #f87171);
}
.hue-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #0b0b10;
  cursor: pointer;
}
.hue-val {
  font-size: 12px;
  color: var(--text-3);
  min-width: 34px;
}
.theme-pkgs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pkg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.pkg-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pkg-meta b {
  font-size: 13px;
}
.pkg-meta span {
  font-size: 11.5px;
  color: var(--text-3);
}
.pkg-acts {
  display: flex;
  gap: 6px;
}
.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}
.wall-item {
  position: relative;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
  cursor: pointer;
  aspect-ratio: 16 / 10;
}
.wall-item.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}
.wall-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.wall-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 8px 6px;
  font-size: 11.5px;
  color: #fff;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.68));
}
.wall-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  opacity: 0;
  transition: opacity 0.18s;
}
.wall-item:hover .wall-del {
  opacity: 1;
}
.lm-row {
  display: flex;
  justify-content: center;
  padding-top: 6px;
}

</style>

<style scoped>
.mk-theme-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}
.mk-theme-acts {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
</style>
