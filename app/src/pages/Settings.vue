<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import Icon from '@/components/Icon.vue'
import Toggle from '@/components/Toggle.vue'
import Modal from '@/components/Modal.vue'
import Slider from '@/components/Slider.vue'
import { call, isDesktop } from '@/api'
import { checkUpdate, type UpdateInfo } from '@/utils/update-check'
import { searchSettings } from '@/settings/schema'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { platformLabel } from '@/utils/labels'
import type { AppSettings, SourceInfo, PluginInfo, PluginSubscription, WallpaperItem } from '@shared/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()

type Cat = 'appearance' | 'wallpaper' | 'playback' | 'lyric' | 'video' | 'sources' | 'local' | 'cache' | 'shortcuts' | 'about'
const cat = ref<Cat>('appearance')

const cats: { key: Cat; label: string; icon: string }[] = [
  { key: 'appearance', label: '外观主题', icon: 'palette' },
  { key: 'wallpaper', label: '壁纸引擎', icon: 'sparkles' },
  { key: 'playback', label: '播放', icon: 'play-circle' },
  { key: 'lyric', label: '歌词', icon: 'lyric' },
  { key: 'video', label: '视频与弹幕', icon: 'video' },
  { key: 'sources', label: '音源与插件', icon: 'plug' },
  { key: 'local', label: '本地音乐', icon: 'folder' },
  { key: 'cache', label: '网络与缓存', icon: 'database' },
  { key: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { key: 'about', label: '关于', icon: 'info' },
]

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
type MarketEntry = { name: string; file: string; version?: string; author?: string; platform?: string; description?: string; types?: string[]; url: string }
const marketEntries = ref<MarketEntry[]>([])
/** 数据目录改过之后，存下重启后的目标路径，用于提示横幅 */
const dataRestart = ref('')

const qrOpen = ref(false)
const qrImg = ref('')
const qrStatus = ref('')
const qrKey = ref('')
let qrTimer: number | null = null

const ACCENTS = ['#ff4d6d', '#a855f7', '#3cb371', '#4f9cf9', '#f0b429', '#ff7a45', '#22d3ee', '#e879f9']

const qualityOptions: { value: AppSettings['quality']; label: string }[] = [
  { value: '128k', label: '标准 128K' },
  { value: '320k', label: '高品质 320K' },
  { value: 'flac', label: '无损 FLAC' },
  { value: 'flac24bit', label: 'Hi-Res 24bit' },
]

const setting = computed(() => ui.settings)

async function patch(p: Partial<AppSettings>): Promise<void> {
  await ui.patch(p)
}

/* ---------------- 播放页背景（封面模糊 / 动态渐变 / 壁纸 / 纯色） ---------------- */

const isMobile = __MOBILE__
/** 应用版本号：构建期注入，与 app/package.json 一致 */
const appVersion = __APP_VERSION__
const wallpaperInput = ref<HTMLInputElement | null>(null)
/** 当前播放页背景模式 */
const bgMode = computed<AppSettings['playerBg']>(() => setting.value.playerBg || 'cover')
/** 壁纸的可显示地址：桌面是本地文件路径，移动端是 data URL */
const wallpaperSrc = computed(() => {
  const p = (setting.value.playerWallpaper || '').trim()
  if (!p) return ''
  if (/^(https?|data|file):/i.test(p)) return p
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
})

/** 选壁纸：桌面走系统文件对话框，移动端走系统相册（<input type=file>） */
async function pickWallpaper(): Promise<void> {
  if (isMobile) {
    wallpaperInput.value?.click()
    return
  }
  try {
    const p = await call<string>('wallpaper:pick')
    if (!p) return
    await patch({ playerWallpaper: p, playerBg: 'wallpaper' })
    ui.toast('壁纸已更新', 'success')
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

/** 移动端选图：压到长边 1920 的 JPEG 再存，避免把几 MB 原图写进设置文件 */
function onWallpaperFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1920 / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(img.width * scale))
      cv.height = Math.max(1, Math.round(img.height * scale))
      const ctx = cv.getContext('2d')
      if (!ctx) {
        ui.toast('图片处理失败', 'error')
        return
      }
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      void patch({ playerWallpaper: cv.toDataURL('image/jpeg', 0.85), playerBg: 'wallpaper' })
        .then(() => ui.toast('壁纸已更新', 'success'))
        .catch((err: any) => ui.toast(err?.message || '设置失败', 'error'))
    }
    img.onerror = () => ui.toast('图片读取失败', 'error')
    img.src = String(reader.result || '')
  }
  reader.readAsDataURL(f)
}

async function clearWallpaper(): Promise<void> {
  await patch({ playerWallpaper: '' })
  ui.toast('已清除壁纸', 'info')
}

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

/* ---------------- 壁纸引擎（图片库） ---------------- */
const wallpapers = ref<WallpaperItem[]>([])
const wallBusy = ref(false)

function wallUrl(p: string): string {
  if (!p) return ''
  if (/^(https?|data|file):/i.test(p)) return p
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
}

async function loadWallpapers(): Promise<void> {
  if (!isDesktop) return
  try {
    const list = await call<WallpaperItem[]>('wallpaper:list')
    wallpapers.value = Array.isArray(list) ? list : []
  } catch {
    wallpapers.value = []
  }
}

async function addWallpaper(): Promise<void> {
  if (isMobile) {
    wallpaperInput.value?.click()
    return
  }
  try {
    const p = await call<string>('wallpaper:pick')
    if (!p) return
    wallBusy.value = true
    const item = await call<WallpaperItem>('wallpaper:import', { path: p })
    await loadWallpapers()
    await patch({ wallpaperId: item.id, playerBg: 'wallpaper', wallpaperEnabled: true })
    ui.toast('壁纸已加入库', 'success')
  } catch (e: any) {
    ui.toast(e?.message || '导入失败', 'error')
  } finally {
    wallBusy.value = false
  }
}

async function applyWallpaper(id: string): Promise<void> {
  await patch({ wallpaperId: id, playerBg: 'wallpaper', wallpaperEnabled: true })
  ui.toast('已应用壁纸', 'success', 1400)
}

async function removeWallpaperItem(id: string): Promise<void> {
  try {
    await call('wallpaper:remove', { id })
    await loadWallpapers()
    if (setting.value.wallpaperId === id) await patch({ wallpaperId: '' })
    ui.toast('已删除壁纸', 'info', 1400)
  } catch (e: any) {
    ui.toast(e?.message || '删除失败', 'error')
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
    sources.value = await call<SourceInfo[]>('sources:toggle', { file: s.file, enabled: !s.enabled })
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
    plugins.value = await call<PluginInfo[]>('plugins:toggle', { file: p.file, enabled: !p.enabled })
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

/** 打开插件市场：拉取在线目录 manifest */
async function loadMarket(): Promise<void> {
  marketOpen.value = true
  marketLoading.value = true
  marketError.value = ''
  try {
    // 走后端 request（net.fetch + 代理），避免渲染层直连 raw.githubusercontent 触发 fetch failed
    marketEntries.value = await call<MarketEntry[]>('plugins:market', { url: OFFICIAL_SUB_URL })
    if (!marketEntries.value.length) marketError.value = '目录为空'
  } catch (e: any) {
    marketError.value = `插件市场加载失败：${e.message}`
  } finally {
    marketLoading.value = false
  }
}

/** 某个市场条目是否已安装（按 file 名匹配） */
function isInstalled(file: string): PluginInfo | undefined {
  return plugins.value.find(p => p.file === file)
}

/** 从市场安装/更新一个插件 */
async function installFromMarket(entry: MarketEntry): Promise<void> {
  marketUpdating.value = entry.file
  try {
    await call('plugins:import', { url: entry.url, origin: 'subscribe' })
    ui.toast(`已安装/更新 ${entry.name}`, 'success')
    await loadPlugins()
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
  try {
    subs.value = await call<PluginSubscription[]>('plugins:subs:remove', { url })
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

async function changeLogDir(): Promise<void> {
  try {
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
    ui.toast(`检查更新失败：${e.message}`, 'error')
  } finally {
    updateChecking.value = false
  }
}

async function openUpdatePage(): Promise<void> {
  const url = updateInfo.value?.url || `https://github.com/${'mancking/StarWish-Music'}/releases/latest`
  if (isDesktop) {
    await call('app:openExternal', { url }).catch(() => {})
    return
  }
  // 移动端 WebView 无 window.open 多窗口支持：复制链接给系统浏览器
  try {
    await navigator.clipboard.writeText(url)
    ui.toast('下载页链接已复制，请在浏览器打开', 'success')
  } catch {
    ui.toast(url, 'info', 8000)
  }
}

async function restartApp(): Promise<void> {
  await call('app:relaunch').catch(() => {})
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
  qrStatus.value = '正在获取二维码…'
  qrImg.value = ''
  stopPoll()
  try {
    const r = await call<{ url: string; key: string }>('bili:qr')
    qrKey.value = r.key
    qrImg.value = await QRCode.toDataURL(r.url, { margin: 1, width: 220, color: { dark: '#111827', light: '#ffffff' } })
    qrStatus.value = '请使用视频源账号扫码登录'
    qrTimer = window.setInterval(poll, 2000)
  } catch (e: any) {
    qrStatus.value = e?.message || '二维码获取失败'
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
  await Promise.all([loadSources(), loadMeta(), loadPlugins(), loadSubs(), loadWallpapers()])
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

    <div class="layout">
      <aside class="cats">
        <button v-for="c in cats" :key="c.key" class="cat" :class="{ active: cat === c.key }" @click="cat = c.key">
          <Icon :name="c.icon" :size="16" />
          <span>{{ c.label }}</span>
        </button>
      </aside>

      <div class="panel">
        <!-- 外观 -->
        <section v-if="cat === 'appearance'">
          <h2>外观主题</h2>
          <div class="row">
            <div class="label"><b>主题模式</b><span>深色适合夜间长时间听歌</span></div>
            <div class="seg">
              <button :class="{ on: setting.theme === 'dark' }" @click="patch({ theme: 'dark' })"><Icon name="moon" :size="14" />深色</button>
              <button :class="{ on: setting.theme === 'light' }" @click="patch({ theme: 'light' })"><Icon name="sun" :size="14" />浅色</button>
              <button :class="{ on: setting.theme === 'auto' }" @click="patch({ theme: 'auto' })"><Icon name="monitor" :size="14" />跟随系统</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>强调色</b><span>自动模式下会跟随当前封面主色变化</span></div>
            <div class="accent-wrap">
              <button class="mini-chip" :class="{ on: setting.accentMode === 'auto' }" @click="patch({ accentMode: 'auto' })">自动取色</button>
              <button class="mini-chip" :class="{ on: setting.accentMode === 'custom' }" @click="patch({ accentMode: 'custom' })">自定义</button>
              <div class="swatches">
                <button
                  v-for="c in ACCENTS"
                  :key="c"
                  class="swatch"
                  :class="{ on: setting.accentMode === 'custom' && setting.accent.toLowerCase() === c }"
                  :style="{ background: c }"
                  @click="patch({ accentMode: 'custom', accent: c })"
                />
                <input
                  type="color"
                  class="color-input"
                  :value="setting.accent"
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
            <div class="label"><b>列表密度</b><span>影响歌曲列表行高与一屏可见数量</span></div>
            <div class="seg">
              <button :class="{ on: setting.listDensity === 'compact' }" @click="patch({ listDensity: 'compact' })">紧凑</button>
              <button :class="{ on: setting.listDensity === 'standard' }" @click="patch({ listDensity: 'standard' })">标准</button>
              <button :class="{ on: setting.listDensity === 'relaxed' }" @click="patch({ listDensity: 'relaxed' })">宽松</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>播放页背景</b><span>封面模糊、动态渐变、自定义壁纸或纯色</span></div>
            <div class="seg">
              <button :class="{ on: bgMode === 'cover' }" @click="patch({ playerBg: 'cover' })">封面模糊</button>
              <button :class="{ on: bgMode === 'gradient' }" @click="patch({ playerBg: 'gradient' })">动态渐变</button>
              <button :class="{ on: bgMode === 'wallpaper' }" @click="patch({ playerBg: 'wallpaper' })">壁纸</button>
              <button :class="{ on: bgMode === 'solid' }" @click="patch({ playerBg: 'solid' })">纯色</button>
            </div>
          </div>

          <div v-if="bgMode === 'wallpaper'" class="row">
            <div class="label"><b>壁纸图片</b><span>{{ wallpaperSrc ? '已设置自定义壁纸' : '还没有选择壁纸' }}</span></div>
            <div class="inline">
              <button class="btn sm" @click="pickWallpaper"><Icon name="folder-open" :size="14" />选择图片</button>
              <button v-if="wallpaperSrc" class="btn sm ghost" @click="clearWallpaper">清除</button>
              <img v-if="wallpaperSrc" class="wall-thumb" :src="wallpaperSrc" alt="壁纸预览" />
            </div>
          </div>
          <input
            ref="wallpaperInput"
            type="file"
            accept="image/*"
            class="hidden-file"
            @change="onWallpaperFile"
          />
        </section>

        <!-- 壁纸引擎 -->
        <section v-else-if="cat === 'wallpaper'">
          <h2>壁纸引擎</h2>
          <p class="hint">图片壁纸库：导入多张图片、轮播、调节显示属性。壁纸只作用于应用内播放页，不修改系统桌面。</p>

          <div class="row">
            <div class="label"><b>启用壁纸</b><span>关闭后播放页回到封面模糊背景</span></div>
            <Toggle :model-value="setting.wallpaperEnabled" @update:model-value="v => patch({ wallpaperEnabled: v })" />
          </div>

          <div class="row">
            <div class="label"><b>背景来源</b><span>决定播放页使用哪种背景</span></div>
            <div class="seg">
              <button :class="{ on: bgMode === 'cover' }" @click="patch({ playerBg: 'cover' })">封面模糊</button>
              <button :class="{ on: bgMode === 'gradient' }" @click="patch({ playerBg: 'gradient' })">动态渐变</button>
              <button :class="{ on: bgMode === 'wallpaper' }" @click="patch({ playerBg: 'wallpaper' })">壁纸</button>
              <button :class="{ on: bgMode === 'solid' }" @click="patch({ playerBg: 'solid' })">纯色</button>
            </div>
          </div>

          <template v-if="!isMobile">
            <div class="wall-head">
              <b>壁纸库</b>
              <span>{{ wallpapers.length }} 张</span>
            </div>
            <div class="wall-grid">
              <button
                v-for="w in wallpapers"
                :key="w.id"
                class="wall-item"
                :class="{ on: setting.wallpaperId === w.id }"
                :title="w.name"
                @click="applyWallpaper(w.id)"
              >
                <img :src="wallUrl(w.thumb)" :alt="w.name" />
                <span class="wall-name">{{ w.name }}</span>
                <span class="wall-del" title="删除" @click.stop="removeWallpaperItem(w.id)">
                  <Icon name="trash" :size="13" />
                </span>
              </button>
              <button class="wall-add" :disabled="wallBusy" @click="addWallpaper">
                <Icon name="plus" :size="20" />
                <span>{{ wallBusy ? '导入中…' : '添加壁纸' }}</span>
              </button>
            </div>
          </template>

          <div v-else class="row">
            <div class="label"><b>壁纸图片</b><span>{{ wallpaperSrc ? '已设置壁纸' : '还没有选择壁纸' }}</span></div>
            <div class="inline">
              <button class="btn sm" @click="addWallpaper"><Icon name="folder-open" :size="14" />选择图片</button>
              <button v-if="wallpaperSrc" class="btn sm ghost" @click="clearWallpaper">清除</button>
              <img v-if="wallpaperSrc" class="wall-thumb" :src="wallpaperSrc" alt="壁纸预览" />
            </div>
          </div>

          <div class="row">
            <div class="label"><b>轮播方式</b><span>按歌切换 / 定时轮播 / 随机</span></div>
            <div class="inline">
              <select
                class="select"
                :value="setting.wallpaperRotation"
                @change="patch({ wallpaperRotation: ($event.target as HTMLSelectElement).value as any })"
              >
                <option value="off">关闭</option>
                <option value="song">按歌切换</option>
                <option value="timer">定时轮播</option>
                <option value="random">随机</option>
              </select>
              <select
                v-if="setting.wallpaperRotation === 'timer'"
                class="select"
                :value="String(setting.wallpaperIntervalMin)"
                @change="patch({ wallpaperIntervalMin: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option value="1">1 分钟</option>
                <option value="5">5 分钟</option>
                <option value="15">15 分钟</option>
                <option value="30">30 分钟</option>
              </select>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>模糊</b><span>{{ setting.wallpaperBlur }} px</span></div>
            <Slider :model-value="setting.wallpaperBlur" :max="40" :step="1" @update:model-value="v => patch({ wallpaperBlur: Math.round(v) })" />
          </div>

          <div class="row">
            <div class="label"><b>遮罩浓度</b><span>{{ Math.round(setting.wallpaperMask * 100) }}%，越高文字越清晰</span></div>
            <Slider :model-value="setting.wallpaperMask * 100" :max="100" :step="1" @update:model-value="v => patch({ wallpaperMask: v / 100 })" />
          </div>

          <div class="row">
            <div class="label"><b>亮度</b><span>浅色壁纸建议调低</span></div>
            <select
              class="select"
              :value="String(Math.round(setting.wallpaperBrightness * 100))"
              @change="patch({ wallpaperBrightness: Number(($event.target as HTMLSelectElement).value) / 100 })"
            >
              <option value="70">70%</option>
              <option value="85">85%</option>
              <option value="100">100%</option>
              <option value="115">115%</option>
              <option value="130">130%</option>
            </select>
          </div>

          <div class="row">
            <div class="label"><b>填充方式</b><span>图片比例与屏幕不一致时如何处理</span></div>
            <div class="seg">
              <button :class="{ on: setting.wallpaperFit === 'cover' }" @click="patch({ wallpaperFit: 'cover' })">填充</button>
              <button :class="{ on: setting.wallpaperFit === 'contain' }" @click="patch({ wallpaperFit: 'contain' })">适应</button>
              <button :class="{ on: setting.wallpaperFit === 'fill' }" @click="patch({ wallpaperFit: 'fill' })">拉伸</button>
            </div>
          </div>

          <div class="row">
            <div class="label"><b>缩放</b><span>轻微放大可以避免边缘模糊</span></div>
            <select
              class="select"
              :value="String(Math.round(setting.wallpaperScale * 100))"
              @change="patch({ wallpaperScale: Number(($event.target as HTMLSelectElement).value) / 100 })"
            >
              <option value="100">100%</option>
              <option value="106">106%</option>
              <option value="115">115%</option>
              <option value="130">130%</option>
            </select>
          </div>
        </section>

        <!-- 视频与弹幕 -->
        <section v-else-if="cat === 'video'">
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

        <!-- 播放 -->
        <section v-else-if="cat === 'playback'">
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
        <section v-else-if="cat === 'lyric'">
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
        <section v-else-if="cat === 'sources'">
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

          <!-- 插件库（MusicFree 协议） -->
          <div class="sec-head" style="margin-top: 30px">
            <div>
              <h2>插件库</h2>
              <p class="desc">
                兼容 MusicFree 插件协议 · 当前 {{ plugins.length }} 个 · 可用 {{ plugins.filter(p => !p.loadError && p.enabled).length }} 个
              </p>
            </div>
            <div class="head-btns">
              <button class="btn sm ghost" @click="loadMarket"><Icon name="download" :size="14" />插件市场</button>
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
        <section v-else-if="cat === 'local'">
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
        <section v-else-if="cat === 'cache'">
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
        <section v-else-if="cat === 'shortcuts'">
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
            </div>
            <div style="display:flex;gap:8px;flex:none">
              <button class="btn sm ghost" :disabled="updateChecking" @click="doCheckUpdate">
                <Icon name="refresh" :size="14" />{{ updateChecking ? '检查中…' : '检查更新' }}
              </button>
              <button v-if="updateInfo?.hasUpdate" class="btn sm" @click="openUpdatePage">
                <Icon name="external" :size="14" />前往下载
              </button>
            </div>
          </div>
        </section>
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

    <!-- 插件市场 -->
    <Modal v-model="marketOpen" title="插件市场" :width="560">
      <p class="tip">星河官方插件库 · 在线目录，点击「安装」添加，已安装的可「更新」</p>
      <div v-if="marketLoading" class="src-list" style="margin-top: 10px">
        <div v-for="i in 3" :key="i" class="sk" style="height: 58px; border-radius: 10px; margin-bottom: 8px" />
      </div>
      <div v-else-if="marketError" class="imp-err">{{ marketError }}</div>
      <div v-else class="src-list" style="margin-top: 10px; max-height: 46vh; overflow-y: auto">
        <div v-for="m in marketEntries" :key="m.file" class="src">
          <div class="src-main">
            <div class="src-title">
              <b>{{ m.name }}</b>
              <span v-if="m.version" class="src-ver">v{{ m.version }}</span>
            </div>
            <div class="src-platforms">
              <span v-for="t in (m.types || []).slice(0, 6)" :key="t" class="pf">{{ pluginTypeLabel(t) }}</span>
            </div>
            <div v-if="m.author || m.description" class="src-plat">
              <span v-if="m.author">{{ m.author }}</span>
              <span v-if="m.description">· {{ m.description }}</span>
            </div>
          </div>
          <div class="src-actions">
            <button class="btn sm" :disabled="marketUpdating === m.file" @click="installFromMarket(m)">
              {{ marketUpdating === m.file ? '处理中…' : isInstalled(m.file) ? '更新' : '安装' }}
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn ghost" @click="marketOpen = false">关闭</button>
        <button class="btn sm ghost" :disabled="marketLoading" @click="loadMarket"><Icon name="refresh" :size="14" />刷新</button>
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

    <!-- 视频源登录 -->
    <Modal v-model="qrOpen" title="视频源扫码登录" :width="380">
      <div class="qr-box">
        <img v-if="qrImg" :src="qrImg" class="qr" alt="视频源登录二维码" />
        <div v-else class="qr-placeholder"><Icon name="qr" :size="40" :stroke="1.2" /></div>
        <p class="qr-status">{{ qrStatus }}</p>
        <p class="qr-tip">登录态仅保存在本机，用于获取更高清晰度的视频与音频流。</p>
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

/* ---------------- 壁纸库 ---------------- */
.wall-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 18px 2px 10px;
}
.wall-head b {
  font-size: 14px;
}
.wall-head span {
  font-size: 12px;
  color: var(--text-3);
}
.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
  margin-bottom: 8px;
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
  transition: border-color 0.2s, transform 0.2s;
}
.wall-item:hover {
  border-color: var(--line-2);
  transform: translateY(-1px);
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
.wall-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  aspect-ratio: 16 / 10;
  border: 1px dashed var(--line-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.wall-add:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.wall-add:disabled {
  opacity: 0.6;
  cursor: default;
}
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
.wall-thumb {
  width: 64px;
  height: 40px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--line-2);
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
.imp-tabs {
  display: flex;
  gap: 6px;
  margin: 6px 0;
}
.imp-tabs button {
  flex: 1;
  padding: 6px 0;
  font-size: 12px;
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
</style>
