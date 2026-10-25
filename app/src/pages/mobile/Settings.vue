<script setup lang="ts">
import { computed, defineOptions, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Toggle from '@/components/Toggle.vue'
import { call, on } from '@/api'
import { registerPopupCloser } from '@/mobile/popup-stack'
import { checkUpdate, type UpdateInfo } from '@/utils/update-check'
import { defsOf, type SettingCat, type SettingDef } from '@/settings/schema'
import { useUiStore } from '@/stores/ui'
import { usePlayerStore } from '@/stores/player'
import { useDownloadStore } from '@/stores/download'
import type { AppSettings, SourceInfo } from '@shared/types'

/**
 * 移动端设置页 —— 模板级重写（v1.0.0）。
 *
 * 结构对齐市面移动 App 的「一级分组入口 + 二级分组页」范式（iOS 设置 /
 * 小米音乐 / QQ 音乐一致）：
 *   一级：只列分组（外观 / 播放 / 歌词 / 下载 / 音源 / 账号 / 网络 / 关于与更新）
 *   二级：独立子页，标题栏带返回，控件为大触控目标的行式布局
 *
 * 与旧版（复用桌面 3000 行 Settings.vue）的实质差异：
 *   - 桌面专属项（壁纸引擎、WebDAV、快捷键、任务栏歌词）不出现
 *   - 移动端专属项（应用内更新、下载位置、退出应用）成为一级入口
 *   - 「关于与更新」独立成页：检查更新 → 应用内下载 APK → 拉起安装器
 */
defineOptions({ name: 'Settings' })

const router = useRouter()
const ui = useUiStore()
const player = usePlayerStore()
const download = useDownloadStore()

type Group = 'appearance' | 'playback' | 'lyric' | 'download' | 'sources' | 'network' | 'about'
/** '' = 一级分组列表；否则为该分组二级页 */
const group = ref<Group | ''>('')

const groups: { key: Group; label: string; desc: string; icon: string }[] = [
 //外观与主题与壁纸两个分组内容重叠，移动端同样合并为一个分组
  { key: 'appearance', label: '外观与主题', desc: '主题、强调色、皮肤、壁纸', icon: 'palette' },
  { key: 'playback', label: '播放', desc: '音质、倍速、播放模式', icon: 'play-circle' },
  { key: 'lyric', label: '歌词', desc: '字号、偏移、字体', icon: 'lyric' },
  { key: 'download', label: '下载', desc: '下载音质与保存位置', icon: 'download' },
  { key: 'sources', label: '音源与插件', desc: '音源开关、插件市场', icon: 'plug' },
  { key: 'network', label: '网络与缓存', desc: '代理、缓存上限', icon: 'wifi' },
  { key: 'about', label: '关于与更新', desc: '版本、检查更新', icon: 'info' },
]

const settings = computed(() => ui.settings)


/* ---------------- 主题与壁纸（4.7+ · 移动端对等） ---------------- */
interface ThemeItem {
  id: string
  name: string
  author: string
  version: string
  colors: { primary?: string; accent?: string }
  kind: string
}
const themes = ref<ThemeItem[]>([])
const activeThemeId = ref('default')
const THEME_SWATCHES = ['#a78bfa', '#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#c084fc', '#fb923c', '#4ade80', '#e879f9', '#94a3b8']

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
    ui.apply()
    ui.toast('主题已应用', 'success', 1400)
  } catch (e: any) {
    ui.toast(e?.message || '应用失败', 'error', 1800)
  }
}
async function pickSwatch(c: string): Promise<void> {
  await ui.patch({ accentMode: 'custom', accent: c })
  ui.apply()
}

/** 色相滑杆（0~360°）：与桌面端同口径，转 HEX 后走 custom accent */
const themeHue = ref(262)
function hslToHex(h: number, s = 0.72, l = 0.62): string {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}`
}
async function pickHue(h: number): Promise<void> {
  await ui.patch({ accentMode: 'custom', accent: hslToHex(h) })
  ui.apply()
}

/* 开源壁纸（浏览 + 保存到系统媒体库；播放页背景壁纸模式依赖本地库） */
interface OnlineWall { id: string; thumb: string; full: string; w: number; h: number; source: string }
const onlineWalls = ref<OnlineWall[]>([])
const onlineLoading = ref(false)
const onlineFailed = ref(false)
const onlineEnd = ref(false)
const onlineQ = ref('')
let onlinePage = 0
let onlineTimer = 0
async function loadOnline(reset = false): Promise<void> {
  if (onlineLoading.value) return
  onlineLoading.value = true
  onlineFailed.value = false
  try {
    const page = reset ? 1 : onlinePage + 1
    const r = await call<{ list: OnlineWall[]; degraded: boolean; end: boolean }>('wallpaper:online:list', { page, q: onlineQ.value, refresh: reset })
    const list = r?.list || []
    onlineWalls.value = reset ? list : [...onlineWalls.value, ...list]
    onlinePage = page
    onlineEnd.value = !!r?.end
    onlineFailed.value = !!r?.degraded
  } catch {
    onlineFailed.value = true
  } finally {
    onlineLoading.value = false
  }
}
function onOnlineQ(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  window.clearTimeout(onlineTimer)
  onlineTimer = window.setTimeout(() => {
    onlineQ.value = v.trim()
    void loadOnline(true)
  }, 300)
}
async function saveWallToMedia(w: OnlineWall): Promise<void> {
  try {
    const res = await fetch(w.full)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const { nativeCall } = await import('@/mobile/bridge')
    const { bytesToBase64 } = await import('@/mobile/base64')
    await nativeCall('SwBridge', 'saveToMedia', {
      name: `星河壁纸-${w.id}.jpg`,
      mime: 'image/jpeg',
 //分块 base64，不再展开实参（4MB spread 必崩）
      data: bytesToBase64(buf),
    })
    ui.toast('壁纸已保存到相册/媒体库', 'success', 1800)
  } catch (e: any) {
    ui.toast(e?.message || '保存失败', 'error', 1800)
  }
}
watch(group, g => {
 // 外观与主题合并后，皮肤/壁纸数据随该分组一并预取
  if (g === 'appearance') {
    if (!themes.value.length) void loadThemes()
    if (!onlineWalls.value.length) void loadOnline(true)
  }
})

/* ---------------- 二级页：schema 驱动的设置项 ---------------- */
function defsOfGroup(g: Group): SettingDef[] {
  const map: Record<Group, SettingCat> = {
    appearance: 'appearance',
    playback: 'playback',
    lyric: 'lyric',
    download: 'download',
    sources: 'sources',
    network: 'cache',
    about: 'about',
  }
  return defsOf(map[g], true)
}

function displayValue(d: SettingDef): string {
  const v = (settings.value as any)[d.key]
  if (d.type === 'toggle') return v ? '已开启' : '已关闭'
  const opt = d.options?.find(o => o.value === v)
  if (opt) return opt.label
  if (d.type === 'slider') return `${Math.round(Number(v) * (d.scale || 1))}${d.unit || ''}`
  return String(v ?? '')
}

async function setValue(d: SettingDef, v: any): Promise<void> {
  await ui.patch({ [d.key]: v } as Partial<AppSettings>)
}

/* 下拉选择：用底部抽屉，避免原生 select 在移动端样式失控 */
const pickerOpen = ref(false)
const pickerDef = ref<SettingDef | null>(null)
const pickerValue = ref<any>(null)

function openPicker(d: SettingDef): void {
  pickerDef.value = d
  pickerValue.value = (settings.value as any)[d.key]
  pickerOpen.value = true
}

async function pickOption(v: any): Promise<void> {
  const d = pickerDef.value
  pickerOpen.value = false
  if (!d) return
  await setValue(d, v)
}

/* ---------------- 音源 ---------------- */
const sources = ref<SourceInfo[]>([])
/* /F-23：移动端音源管理动作 */
async function importSourceUrl(): Promise<void> {
  const url = window.prompt('粘贴音源 .js 的 http(s) 直链')
  if (!url) return
  try {
    await call('sources:import', { url })
    sources.value = await call<SourceInfo[]>('sources:list')
    ui.toast('音源导入成功', 'success', 1800)
  } catch (e: any) {
    ui.toast(e?.message || '导入失败', 'error', 2400)
  }
}

async function importSourceLocal(): Promise<void> {
  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.js,text/javascript'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const content = await f.text()
        await call('sources:import', { content })
        sources.value = await call<SourceInfo[]>('sources:list')
        ui.toast('音源导入成功', 'success', 1800)
      } catch (e: any) {
        ui.toast(e?.message || '导入失败', 'error', 2400)
      }
    }
    input.click()
  } catch (e: any) {
    ui.toast(e?.message || '选择文件失败', 'error', 2000)
  }
}

async function restoreSources(): Promise<void> {
  try {
    sources.value = await call<SourceInfo[]>('sources:restore')
    ui.toast('已恢复内置音源', 'success', 1600)
  } catch (e: any) {
    ui.toast(e?.message || '恢复失败', 'error', 2000)
  }
}

async function removeSource(s: SourceInfo): Promise<void> {
  if (!window.confirm(`删除音源「${s.name}」？`)) return
  try {
    sources.value = await call<SourceInfo[]>('sources:delete', { file: s.file })
    ui.toast('已删除', 'info', 1400)
  } catch (e: any) {
    ui.toast(e?.message || '删除失败', 'error', 2000)
  }
}

function showSource(s: SourceInfo): void {
  window.alert(`${s.name}
${s.description || ''}
平台：${(s.platforms || []).map((p: any) => p.name || p.platform).join('、') || '无'}`)
}
async function loadSources(): Promise<void> {
  try {
    sources.value = await call<SourceInfo[]>('sources:list')
  } catch {
    sources.value = []
  }
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

/* ---------------- 插件市场（MusicFree 协议插件） ---------------- */
/** 官方插件库 manifest 地址（与桌面端保持一致） */
const OFFICIAL_SUB_URL = 'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Plugin-Library/manifest.json'
type MarketEntry = {
  kind?: 'lx-source' | 'musicfree-plugin' | 'video-source' | 'theme'
  name: string
  file?: string
  version?: string
  author?: string
  platform?: string
  description?: string
  types?: string[]
  canUpdate?: boolean
  installed?: boolean
  url: string
}
const marketOpen = ref(false)
const marketLoading = ref(false)
const marketError = ref('')
const marketEntries = ref<MarketEntry[]>([])
const marketUpdating = ref('')
const installedFiles = ref<string[]>([])
/** 已安装插件的名字（清单里 file 可能被导入时改写，名字更稳定） */
const installedNames = ref<string[]>([])

async function loadInstalledPlugins(): Promise<void> {
  try {
    const list = await call<{ file?: string; name?: string }[]>('plugins:list')
    installedFiles.value = (list || []).map(p => String(p.file || '')).filter(Boolean)
    installedNames.value = (list || []).map(p => String(p.name || '')).filter(Boolean)
  } catch {
    installedFiles.value = []
    installedNames.value = []
  }
}

/** 市场 Tab 过滤 + 搜索（0.10.3 移动端对等：全部/音源/插件/视频源/主题） */
const marketTab = ref<'all' | 'lx-source' | 'musicfree-plugin' | 'video-source'>('all')
// Guard against legacy theme entries accidentally published to the plugin manifest.
const marketQ = ref('')
/** 插件市场与主题市场是两个不同分支：主题不混入插件市场（走独立「主题市场」入口） */
const MARKET_TABS = [
  { key: 'all', label: '全部' },
  { key: 'lx-source', label: '音源' },
  { key: 'musicfree-plugin', label: '插件' },
  { key: 'video-source', label: '视频源' },
] as const
const marketShown = computed(() => {
  const q = marketQ.value.trim().toLowerCase()
  return marketEntries.value.filter(m => {
    if (m.kind === 'theme') return false
    if (marketTab.value !== 'all' && (m.kind || 'musicfree-plugin') !== marketTab.value) return false
    if (q && !`${m.name} ${m.description || ''} ${m.author || ''}`.toLowerCase().includes(q)) return false
    return true
  })
})
function kindLabel(m: MarketEntry): string {
  const map: Record<string, string> = {
    'lx-source': '音源',
    'musicfree-plugin': '插件',
    'video-source': '视频源',
    theme: '主题',
  }
  return map[m.kind || 'musicfree-plugin'] || '插件'
}
/** 来源标注（0.10.3）：市场/订阅/本地/URL */
function originLabel(m: MarketEntry): string {
  const o = (m as any).origin
  return o === 'subscribe' ? '订阅' : o === 'local' ? '本地' : o === 'url' ? 'URL' : '市场'
}

/** 在线主题库（独立分支 Star-Wish-Theme-Library，与插件市场分离） */
const THEME_MARKET_URL =
  'https://raw.githubusercontent.com/mancking/StarWish-Music/Star-Wish-Theme-Library/manifest.json'
const tmOpen = ref(false)
const tmTab = ref<'theme' | 'wallpaper'>('theme')
const tmItems = ref<MarketEntry[]>([])
const tmLoading = ref(false)
const tmErr = ref('')
const tmUpdating = ref('')
async function loadThemeMarket(force = false): Promise<void> {
  tmLoading.value = true
  tmErr.value = ''
  try {
    tmItems.value = await call<MarketEntry[]>('market:themes', { url: THEME_MARKET_URL, force })
  } catch (e: any) {
    tmItems.value = []
    tmErr.value = e?.message || '主题库加载失败'
  } finally {
    tmLoading.value = false
  }
}
/** 主题市场入口：独立分支（不再复用插件市场面板） */
async function openThemeMarket(): Promise<void> {
  tmOpen.value = true
  if (!tmItems.value.length) void loadThemeMarket()
}
async function installTm(m: MarketEntry): Promise<void> {
  tmUpdating.value = m.url
  try {
    await call(m.installed && m.canUpdate ? 'market:update' : 'market:install', { item: m as any })
    ui.toast(`${m.installed && m.canUpdate ? '已更新' : '已安装'} ${m.name}`, 'success', 1800)
    await Promise.all([loadThemes(), loadThemeMarket()])
  } catch (e: any) {
    ui.toast(`安装失败：${e?.message || e}`, 'error', 3200)
  } finally {
    tmUpdating.value = ''
  }
}
async function uninstallTm(m: MarketEntry): Promise<void> {
  tmUpdating.value = m.url
  try {
    await call('market:uninstall', { item: m as any })
    ui.toast(`已卸载 ${m.name}`, 'info', 1600)
    await Promise.all([loadThemes(), loadThemeMarket()])
  } catch (e: any) {
    ui.toast(`卸载失败：${e?.message || e}`, 'error', 2800)
  } finally {
    tmUpdating.value = ''
  }
}

/** 落雪式初始化状态文案 */
function initStateLabel(s: SourceInfo): { text: string; cls: string } {
  const st = (s as any).initState
  if (s.loadError || st === 'failed') return { text: s.loadError ? '初始化失败' : '初始化失败', cls: 'bad' }
  if (st === 'initing') return { text: '初始化中…', cls: 'busy' }
  if (s.enabled) return { text: '就绪', cls: 'ok' }
  return { text: '已停用', cls: 'off' }
}



/** 打开插件市场：拉取在线目录（market:list，带安装态）。force=true 绕过缓存强制拉远端 */
async function loadMarket(force = false): Promise<void> {
  marketOpen.value = true
  marketLoading.value = true
  marketError.value = ''
  try {
 //改用 market:list（宿主侧带 installed/canUpdate），
    // 旧的 plugins:market 只回 manifest 原始条目，安装态靠名字猜，更新永远判不出来
    const list = await call<MarketEntry[]>('market:list', { url: (settings.value as any).marketUrl || OFFICIAL_SUB_URL, force })
    marketEntries.value = (list || []).filter(x => x.kind !== 'theme').map(x => ({ ...x, installed: !!(x as any).installed }))
    if (!marketEntries.value.length) marketError.value = '目录为空，请稍后重试'
  } catch (e: any) {
    marketEntries.value = []
    marketError.value = `插件市场加载失败：${e?.message || e}`
  } finally {
    marketLoading.value = false
  }
}

function isInstalled(entry: MarketEntry): boolean {
  if (entry.installed) return true
  if (entry.file && installedFiles.value.includes(entry.file)) return true
  return installedNames.value.includes(entry.name)
}

/**统一安装/更新（kind 路由），装完刷新市场条目状态 */
async function installFromMarket(entry: MarketEntry): Promise<void> {
  marketUpdating.value = entry.url
  const isUpdate = !!entry.installed && !!entry.canUpdate
  try {
    await call(isUpdate ? 'market:update' : 'market:install', { item: entry })
    ui.toast(`${isUpdate ? '已更新' : '已安装'} ${entry.name}`, 'success', 2000)
    await Promise.all([loadInstalledPlugins(), loadSources()])
    await loadMarket()
  } catch (e: any) {
    ui.toast(`安装失败：${e?.message || e}`, 'error', 4200)
  } finally {
    marketUpdating.value = ''
  }
}

/** 卸载（按 sourceUrl 匹配， */
async function uninstallFromMarket(entry: MarketEntry): Promise<void> {
  marketUpdating.value = entry.url
  try {
    await call('market:uninstall', { item: entry })
    ui.toast(`已卸载 ${entry.name}`, 'info', 1600)
    await Promise.all([loadInstalledPlugins(), loadSources()])
    await loadMarket()
  } catch (e: any) {
    ui.toast(`卸载失败：${e?.message || e}`, 'error', 3000)
  } finally {
    marketUpdating.value = ''
  }
}

/* ---------------- 4.8 局域网同步（客户端） ---------------- */
const lanIp = ref('')
const lanPin = ref('')
const lanBusy = ref(false)
const lanResult = ref('')
async function lanSyncNow(): Promise<void> {
  if (lanBusy.value) return
  if (!lanIp.value.trim()) {
    ui.toast('请输入桌面端 IP:端口', 'info', 1800)
    return
  }
  lanBusy.value = true
  try {
    const r = await call<any>('lan:sync', { ip: lanIp.value.trim(), pin: lanPin.value.trim() })
    lanResult.value = `完成：推送 ${r.applied?.favorites || 0} 收藏 / ${r.applied?.history || 0} 记录，拉取 ${r.pulled?.favorites || 0} 收藏 / ${r.pulled?.history || 0} 记录`
    ui.toast('局域网同步完成', 'success', 2000)
  } catch (e: any) {
    lanResult.value = e?.message || '同步失败'
    ui.toast(lanResult.value, 'error', 2600)
  } finally {
    lanBusy.value = false
  }
}

/* ---------------- 关于与更新 ---------------- */
const appInfo = ref<any>(null)
const updateInfo = ref<UpdateInfo | null>(null)
const checking = ref(false)
const downloading = ref(false)
const dlPercent = ref(0)
const dlReceived = ref(0)
const dlTotal = ref(0)

async function loadAppInfo(): Promise<void> {
  try {
    appInfo.value = await call<any>('app:info')
  } catch {
    appInfo.value = null
  }
}

/** 检查更新：优先 GitHub Releases，失败时给出可执行的替代动作 */
async function doCheckUpdate(): Promise<void> {
  if (checking.value) return
  checking.value = true
  updateInfo.value = null
  try {
    const cur = String(appInfo.value?.version || __APP_VERSION__)
    const r = await checkUpdate(cur)
    updateInfo.value = r
    ui.toast(r.hasUpdate ? `发现新版本 v${r.version}` : '当前已是最新版本', r.hasUpdate ? 'success' : 'info', 2600)
  } catch (e: any) {
    ui.toast(`检查更新失败：${e.message}`, 'error', 4200)
  } finally {
    checking.value = false
  }
}

/**
 * 应用内更新：下载 APK → 拉起系统安装器。
 * 首次需要用户授权「安装未知应用」，未授权时先引导到系统设置。
 */
async function doUpdate(): Promise<void> {
  const info = updateInfo.value
  if (!info?.hasUpdate) {
    await doCheckUpdate()
    return
  }
  if (!info.apkUrl) {
    ui.toast('该版本没有可安装的 APK，请到下载页手动获取', 'info', 3600)
    await openReleasePage()
    return
  }
  if (downloading.value) return
  downloading.value = true
  dlPercent.value = 0
  dlReceived.value = 0
  dlTotal.value = 0
  try {
    const allowed = await call<boolean>('app:canInstallPackages').catch(() => true)
    if (!allowed) {
      const go = await call<boolean>('app:openInstallPermission').catch(() => false)
      if (go) {
        ui.toast('请在系统设置中允许「安装未知应用」，然后重新点击更新', 'info', 5200)
      } else {
        ui.toast('请到系统设置中允许「安装未知应用」后重试', 'error', 4200)
      }
      return
    }
    ui.toast('正在下载安装包…', 'info', 2000)
    await call('app:downloadAndInstall', { url: info.apkUrl })
    ui.toast('下载完成，请在弹出的安装器中确认安装', 'success', 6000)
  } catch (e: any) {
    ui.toast(`更新失败：${e.message}`, 'error', 4600)
  } finally {
    downloading.value = false
  }
}

async function openReleasePage(): Promise<void> {
  const url = updateInfo.value?.url || 'https://github.com/mancking/StarWish-Music/releases/latest'
  await call('app:openExternal', { url }).catch(() => {})
}

/* 原生下载进度 */
let offProgress: (() => void) | null = null
/** 统一返回栈登记（onBeforeUnmount 注销） */
let offViewCloser: (() => void) | null = null
onMounted(() => {
  void loadAppInfo()
  void loadSources()
  void loadInstalledPlugins()
  offProgress = on('update:progress', (p: any) => {
    dlPercent.value = Number(p?.percent || 0)
    dlReceived.value = Number(p?.received || 0)
    dlTotal.value = Number(p?.total || 0)
  })
  // 多级页纳入统一返回栈（本轮需求：设置多级页面是返回手势重灾区）。
  // 系统返回键 / 边缘滑动 → handleBack → closeTopPopup 走到这里：
  //   市场浮层 → 选择器 → 二级分组页 → 一级列表（返回 false 穿透到路由栈）
  // closer 约定：真的降级了才 return true，否则让返回穿透到上一层。
  offViewCloser = registerPopupCloser(() => {
    if (marketOpen.value) { marketOpen.value = false; return true }
    if (pickerOpen.value) { pickerOpen.value = false; return true }
    if (group.value) { group.value = ''; return true }
    return false
  })
})

onBeforeUnmount(() => {
  offProgress?.()
  offViewCloser?.()
})

function back(): void {
  if (group.value) group.value = ''
  else if (window.history.length > 1) router.back()
  else router.push('/mine')
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
}

const version = computed(() => String(appInfo.value?.version || __APP_VERSION__))
</script>

<template>
  <div class="page m-set">
    <!-- 标题栏 -->
    <div class="set-topbar">
      <button class="tb-btn" aria-label="返回" @click="back">
        <Icon :name="group ? 'chevron-left' : 'chevron-left'" :size="22" />
      </button>
      <span class="tb-title">{{ group ? groups.find(g => g.key === group)?.label : '设置' }}</span>
      <span class="tb-space" />
    </div>

    <!-- ============ 一级：分组列表 ============ -->
    <template v-if="!group">
      <div class="set-list">
        <button v-for="g in groups" :key="g.key" class="set-row" @click="group = g.key">
          <span class="set-icon" :style="{ background: `color-mix(in srgb, var(--accent) 16%, transparent)`, color: 'var(--accent)' }">
            <Icon :name="g.icon" :size="19" />
          </span>
          <span class="set-meta">
            <span class="set-label">{{ g.label }}</span>
            <span class="set-desc">{{ g.desc }}</span>
          </span>
          <Icon name="chevron-right" :size="16" class="set-arrow" />
        </button>
      </div>
      <div class="set-ver">星河音乐 v{{ version }}</div>
    </template>

    <!-- ============ 二级：分组页 ============ -->
    <template v-else>
      <!-- 外观 -->
      <section v-if="group === 'appearance'" class="set-group">
        <div class="set-card">
          <div v-for="d in defsOfGroup('appearance')" :key="d.key" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ d.label }}</span>
              <span v-if="d.desc" class="it-desc">{{ d.desc }}</span>
            </div>
            <Toggle
              v-if="d.type === 'toggle'"
              :model-value="!!(settings as any)[d.key]"
              @update:model-value="v => setValue(d, v)"
            />
            <button v-else class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
      </section>


      <!-- 皮肤 · 主题包 · 壁纸（外观与主题） -->
      <section v-if="group === 'appearance'" class="set-group">
        <div class="set-card">
          <div class="set-item">
            <div class="it-meta"><span class="it-label">主题市场</span><span class="it-desc">独立分支（主题包 + 开源壁纸），与插件市场分离</span></div>
            <button class="it-value" @click="openThemeMarket">进入<Icon name="chevron-right" :size="14" /></button>
          </div>
        </div>
      </section>

      <section v-if="group === 'appearance'" class="set-group">
        <div class="set-card">
          <div class="set-item" style="flex-direction: column; align-items: stretch">
            <div class="it-meta"><span class="it-label">预置皮肤</span><span class="it-desc">本地内置 5 套，无网络可切换</span></div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px">
              <button
                v-for="t in themes.filter(x => x.kind === 'preset')"
                :key="t.id"
                class="mtheme"
                :class="{ on: activeThemeId === t.id }"
                @click="useTheme(t.id)"
              >
                <span class="mtc" :style="{ background: `linear-gradient(135deg, ${t.colors.primary}, ${t.colors.accent})` }" />
                <span class="mtn">{{ t.name }}</span>
              </button>
            </div>
          </div>
          <div class="set-item" style="flex-direction: column; align-items: stretch">
            <div class="it-meta"><span class="it-label">主题色</span><span class="it-desc">色谱任选：预设色 + 色相滑杆（即时生效）</span></div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px">
              <button
                v-for="c in THEME_SWATCHES"
                :key="c"
                class="msw"
                :class="{ on: String(settings.accent || '').toLowerCase() === c }"
                :style="{ background: c }"
                @click="pickSwatch(c)"
              />
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px">
              <input
                v-model.number="themeHue"
                type="range"
                min="0"
                max="360"
                step="1"
                style="flex: 1"
                @change="pickHue(themeHue)"
              />
              <span class="it-desc" style="width: 40px; text-align: right">{{ themeHue }}°</span>
            </div>
          </div>
        </div>

      </section>

      <!-- 播放 -->
      <section v-else-if="group === 'playback'" class="set-group">
        <div class="set-card">
          <div v-for="d in defsOfGroup('playback')" :key="d.key" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ d.label }}</span>
              <span v-if="d.desc" class="it-desc">{{ d.desc }}</span>
            </div>
            <Toggle
              v-if="d.type === 'toggle'"
              :model-value="!!(settings as any)[d.key]"
              @update:model-value="v => setValue(d, v)"
            />
            <button v-else-if="d.type === 'slider'" class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
            <button v-else class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
        <div class="set-card">
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">当前播放模式</span>
              <span class="it-desc">点击切换</span>
            </div>
            <button class="it-value" @click="player.cycleMode()">
              {{ player.modeLabel }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">当前音质</span>
              <span class="it-desc">点击切换</span>
            </div>
            <button class="it-value" @click="player.setQuality(player.state.quality === '320k' ? 'flac' : '320k')">
              {{ player.state.quality }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
      </section>

      <!-- 歌词 -->
      <section v-else-if="group === 'lyric'" class="set-group">
        <div class="set-card">
          <div v-for="d in defsOfGroup('lyric')" :key="d.key" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ d.label }}</span>
              <span v-if="d.desc" class="it-desc">{{ d.desc }}</span>
            </div>
            <Toggle
              v-if="d.type === 'toggle'"
              :model-value="!!(settings as any)[d.key]"
              @update:model-value="v => setValue(d, v)"
            />
            <button v-else class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
        <p class="set-tip">歌词偏移可正可负：正值让歌词延后出现，负值让歌词提前出现。</p>
      </section>

      <!-- 下载 -->
      <section v-else-if="group === 'download'" class="set-group">
        <div class="set-card">
          <div v-for="d in defsOfGroup('download')" :key="d.key" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ d.label }}</span>
              <span v-if="d.desc" class="it-desc">{{ d.desc }}</span>
            </div>
            <Toggle
              v-if="d.type === 'toggle'"
              :model-value="!!(settings as any)[d.key]"
              @update:model-value="v => setValue(d, v)"
            />
            <button v-else class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
        <div class="set-card">
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">保存位置</span>
              <span class="it-desc">系统音乐库「星河音乐」目录</span>
            </div>
            <span class="it-value static">系统音乐库</span>
          </div>
          <button class="set-item link" @click="router.push('/downloads')">
            <div class="it-meta">
              <span class="it-label">下载管理</span>
              <span class="it-desc">查看进度与已下载歌曲</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
        </div>
      </section>

 <!-- 音源与插件（与桌面对等 —— 导入 URL/本地 JS、订阅、恢复内置、删除） -->
      <section v-else-if="group === 'sources'" class="set-group">
        <div class="set-card">
          <div v-for="s in sources" :key="s.file" class="set-item">
            <div class="it-meta" @click="showSource(s)">
              <span class="it-label">
                {{ s.name }}
                <span class="init-badge" :class="initStateLabel(s).cls">{{ initStateLabel(s).text }}</span>
              </span>
              <span class="it-desc">{{ s.loadError ? s.loadError : s.description || s.platforms?.join(' · ') || '音源脚本' }}</span>
            </div>
            <div class="it-acts">
              <button v-if="!s.builtin" class="mini-act" @click="removeSource(s)">删除</button>
              <Toggle :model-value="s.enabled" @update:model-value="() => toggleSource(s)" />
            </div>
          </div>
          <!-- 空态即引导（0.9.3） -->
          <div v-if="!sources.length" class="set-empty">无可用音源，点下方「导入音源」添加</div>
        </div>
        <div class="set-card">
          <button class="set-item link" @click="importSourceUrl">
            <div class="it-meta">
              <span class="it-label">导入音源（URL）</span>
              <span class="it-desc">粘贴 lx 协议音源 .js 直链</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
          <button class="set-item link" @click="importSourceLocal">
            <div class="it-meta">
              <span class="it-label">导入音源（本地 JS）</span>
              <span class="it-desc">从文件选择 .js 音源脚本</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
          <button class="set-item link" @click="restoreSources">
            <div class="it-meta">
              <span class="it-label">恢复内置音源</span>
              <span class="it-desc">重新加载随包音源（保留禁用选择）</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
          <button class="set-item link" @click="loadMarket(false)">
            <div class="it-meta">
              <span class="it-label">源市场</span>
              <span class="it-desc">安装与更新插件 / 音源 / 视频源</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
        </div>
      </section>

      <!-- 账号 -->
      <!-- 网络与缓存 -->
      <section v-else-if="group === 'network'" class="set-group">
        <div class="set-card">
          <div class="set-item" style="flex-direction: column; align-items: stretch; gap: 8px">
            <div class="it-meta">
              <span class="it-label">局域网同步</span>
              <span class="it-desc">与同一 Wi-Fi 下的桌面端互同步收藏/最近播放/设置（4.8）</span>
            </div>
            <input v-model="lanIp" placeholder="桌面端 IP:端口（如 192.168.1.8:42717）" />
            <input v-model="lanPin" placeholder="桌面端配对码（6 位数字）" inputmode="numeric" maxlength="6" />
            <button class="btn primary" style="width: 100%" :disabled="lanBusy" @click="lanSyncNow">
              {{ lanBusy ? '同步中…' : '连接并同步' }}
            </button>
            <span v-if="lanResult" class="it-desc">{{ lanResult }}</span>
          </div>
        </div>
        <div class="set-card">
          <div v-for="d in defsOfGroup('network')" :key="d.key" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ d.label }}</span>
              <span v-if="d.desc" class="it-desc">{{ d.desc }}</span>
            </div>
            <Toggle
              v-if="d.type === 'toggle'"
              :model-value="!!(settings as any)[d.key]"
              @update:model-value="v => setValue(d, v)"
            />
            <button v-else class="it-value" @click="openPicker(d)">
              {{ displayValue(d) }}<Icon name="chevron-right" :size="14" />
            </button>
          </div>
        </div>
        <p class="set-tip">移动端使用系统网络栈，代理设置需填写 host:port 或 socks5://host:port。</p>
      </section>

      <!-- 关于与更新 -->
      <section v-else-if="group === 'about'" class="set-group">
        <div class="set-card">
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">当前版本</span>
              <span class="it-desc">星河音乐 StarWish Music</span>
            </div>
            <span class="it-value static">v{{ version }}</span>
          </div>
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">最新版本</span>
              <span class="it-desc">{{ updateInfo?.hasUpdate ? '有新版本可更新' : '点击检查更新' }}</span>
            </div>
            <span class="it-value static">{{ updateInfo?.version || '—' }}</span>
          </div>
        </div>

        <div class="set-card">
          <button class="set-item link" :disabled="checking" @click="doCheckUpdate">
            <div class="it-meta">
              <span class="it-label">{{ checking ? '检查中…' : '检查更新' }}</span>
              <span class="it-desc">从 GitHub Releases 获取最新版本信息</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
          <button class="set-item link" :disabled="downloading" @click="doUpdate">
            <div class="it-meta">
              <span class="it-label">{{ downloading ? `下载中 ${dlPercent}%` : '立即更新' }}</span>
              <span class="it-desc">
                {{ downloading ? `已下载 ${fmtBytes(dlReceived)}${dlTotal ? ' / ' + fmtBytes(dlTotal) : ''}` : '应用内下载安装包并拉起系统安装器' }}
              </span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
          <button class="set-item link" @click="openReleasePage">
            <div class="it-meta">
              <span class="it-label">下载页</span>
              <span class="it-desc">在浏览器中打开 Releases 页面</span>
            </div>
            <Icon name="external" :size="16" class="set-arrow" />
          </button>
        </div>

        <div v-if="downloading && dlPercent" class="dl-bar">
          <div class="dl-fill" :style="{ width: dlPercent + '%' }" />
        </div>

        <div v-if="updateInfo?.notes" class="set-notes">
          <div class="notes-title">更新说明</div>
          <pre class="notes-body">{{ updateInfo.notes }}</pre>
        </div>

        <p class="set-tip">本应用内更新在 Android 8.0 及以上需要「安装未知应用」授权，首次更新会引导前往系统设置开启。</p>
      </section>
    </template>

    <!-- 选项选择抽屉 -->
    <Transition name="sheet">
      <div v-if="pickerOpen && pickerDef" class="pick-mask" @click="pickerOpen = false">
        <div class="pick" @click.stop>
          <div class="pick-title">{{ pickerDef.label }}</div>
          <div class="pick-list">
            <button
              v-for="o in pickerDef.options || []"
              :key="String(o.value)"
              class="pick-item"
              :class="{ on: o.value === pickerValue }"
              @click="pickOption(o.value)"
            >
              <span>{{ o.label }}</span>
              <Icon v-if="o.value === pickerValue" name="check" :size="18" />
            </button>
          </div>
          <button class="pick-cancel" @click="pickerOpen = false">取消</button>
        </div>
      </div>
    </Transition>

    <!-- 主题市场（独立分支）：编辑器式固定头，Tab = 主题包 / 开源壁纸 -->
    <div v-if="tmOpen" class="mk-mask" @click.self="tmOpen = false">
      <div class="mk-card">
        <div class="mk-head">
          <b>主题市场</b>
          <button class="mk-close" @click="tmOpen = false"><Icon name="close" :size="16" /></button>
        </div>
        <p class="mk-tip">独立主题库分支（Star-Wish-Theme-Library）：在线主题包一键安装；开源壁纸浏览并保存</p>
        <div class="mk-tabs">
          <button :class="{ on: tmTab === 'theme' }" @click="tmTab = 'theme'">主题包</button>
          <button :class="{ on: tmTab === 'wallpaper' }" @click="tmTab = 'wallpaper'">开源壁纸</button>
        </div>
        <div v-if="tmTab === 'theme'" class="mk-list">
          <div v-if="tmLoading" class="mk-loading">正在拉取主题库…</div>
          <template v-else>
            <div v-for="m in tmItems" :key="m.url" class="mk-item">
              <div class="mk-main">
                <div class="mk-title">
                  <b>{{ m.name }}</b>
                  <span v-if="m.version" class="mk-ver">v{{ m.version }}</span>
                </div>
                <div v-if="m.description" class="mk-desc">{{ m.description }}</div>
              </div>
              <div class="mk-acts">
                <button class="mk-btn" :disabled="tmUpdating === m.url" @click="installTm(m)">
                  {{ tmUpdating === m.url ? '处理中…' : m.installed ? (m.canUpdate ? '更新' : '已装') : '安装' }}
                </button>
                <button v-if="m.installed" class="mk-btn ghost" :disabled="tmUpdating === m.url" @click="uninstallTm(m)">卸载</button>
              </div>
            </div>
            <div v-if="!tmItems.length" class="mk-empty">主题库暂未上架，敬请期待（可先用预置皮肤或本地导入）</div>
          </template>
        </div>
        <div v-else class="mk-list">
          <input class="minput" placeholder="搜索壁纸（过滤，清空回默认）" @input="onOnlineQ" />
          <p v-if="onlineFailed && !onlineWalls.length" class="it-desc" style="color: #f87171">源不可达，请检查网络</p>
          <div class="mwall-grid">
            <button v-for="w in onlineWalls" :key="w.id" class="mwall" @click="saveWallToMedia(w)">
              <img :src="w.thumb" loading="lazy" alt="" />
            </button>
          </div>
          <button v-if="!onlineEnd" class="it-value" style="justify-content: center; width: 100%" :disabled="onlineLoading" @click="loadOnline()">
            {{ onlineLoading ? '加载中…' : '加载更多' }}
          </button>
        </div>
        <div v-if="tmTab === 'theme'" class="mk-foot">
          <button class="mk-btn ghost" :disabled="tmLoading" @click="loadThemeMarket(true)">
            <Icon name="refresh" :size="14" />刷新
          </button>
        </div>
      </div>
    </div>

    <!-- 插件市场：编辑器式固定头（标题/Tab/搜索/底部操作固定，仅列表滚动，
         修「搜索框与 Tab 随内容上下变化」与触控目标过小） -->
    <div v-if="marketOpen" class="mk-mask" @click.self="marketOpen = false">
      <div class="mk-card">
        <div class="mk-head">
          <b>插件市场</b>
          <button class="mk-close" @click="marketOpen = false"><Icon name="close" :size="16" /></button>
        </div>
        <p class="mk-tip">插件与音源独立目录：音源 / 插件 / 视频源，一键安装、更新与卸载</p>
        <!-- Tab 过滤 + 搜索（0.10.3 移动端对等） -->
        <div class="mk-tabs">
          <button
            v-for="t in MARKET_TABS"
            :key="t.key"
            :class="{ on: marketTab === t.key }"
            @click="marketTab = t.key"
          >{{ t.label }}</button>
        </div>
        <input v-model="marketQ" class="mk-search" placeholder="搜索名称 / 描述 / 作者" />
        <div v-if="marketLoading" class="mk-list">
          <div class="mk-loading">正在拉取插件目录…</div>
          <div v-for="i in 3" :key="i" class="mk-sk" />
        </div>
        <div v-else-if="marketError" class="mk-err">{{ marketError }}</div>
        <div v-else class="mk-list">
          <div v-for="m in marketShown" :key="m.file || m.url" class="mk-item">
            <div class="mk-main">
              <div class="mk-title">
                <b>{{ m.name }}</b>
                <span class="mk-kind">{{ kindLabel(m) }} · {{ originLabel(m) }}</span>
                <span v-if="m.version" class="mk-ver">v{{ m.version }}</span>
                <span v-if="m.canUpdate" class="mk-ver upd">可更新</span>
              </div>
              <div v-if="m.author || m.description" class="mk-desc">
                {{ m.author }}<span v-if="m.author && m.description"> · </span>{{ m.description }}
              </div>
            </div>
            <div class="mk-acts">
              <button class="mk-btn" :disabled="marketUpdating === m.url" @click="installFromMarket(m)">
                {{ marketUpdating === m.url ? '处理中…' : m.installed ? (m.canUpdate ? '更新' : '已装') : '安装' }}
              </button>
              <button v-if="m.installed" class="mk-btn ghost" :disabled="marketUpdating === m.url" @click="uninstallFromMarket(m)">
                卸载
              </button>
            </div>
          </div>
          <div v-if="!marketShown.length" class="mk-empty">{{ marketEntries.length ? '没有匹配的条目' : '目录为空' }}</div>
        </div>
        <div class="mk-foot">
          <button class="mk-btn ghost" :disabled="marketLoading" @click="loadMarket(true)">
            <Icon name="refresh" :size="14" />刷新
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-set {
  padding: 0 16px 28px;
}
.set-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  margin: 0 -16px;
  padding: 0 12px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(14px);
}
.tb-btn {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--bg-2);
  color: var(--text);
  -webkit-tap-highlight-color: transparent;
}
.tb-title {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}
.tb-space {
  width: 40px;
}

.set-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
.set-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--bg-2);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.set-row:active {
  filter: brightness(1.15);
}
.set-icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
}
.set-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.set-label {
  font-size: 15.5px;
  font-weight: 600;
  color: var(--text);
}
.set-desc {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.set-arrow {
  flex: none;
  color: var(--text-3);
}
.set-ver {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

.set-group {
  margin-top: 10px;
}
.set-card {
  border-radius: 16px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  overflow: hidden;
}
.set-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 58px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.set-item:last-child {
  border-bottom: 0;
}
.set-item.link:active {
  background: var(--bg);
}
.it-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.it-label {
  font-size: 14.5px;
  color: var(--text);
  font-weight: 500;
}
.it-desc {
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.5;
}
.it-value {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 46%;
  border: 0;
  background: none;
  color: var(--text-2);
  font-size: 13.5px;
  -webkit-tap-highlight-color: transparent;
}
.it-value.static {
  color: var(--text-3);
}
.it-acts {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mini-act {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  padding: 4px 10px;
}
.mini-act:active {
  color: #f87171;
  border-color: #f87171;
}
.set-empty {
  padding: 20px 14px;
  font-size: 12.5px;
  color: var(--text-3);
}
.set-tip {
  margin: 12px 4px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
}

/* 下载进度条 */
.dl-bar {
  margin-top: 12px;
  height: 6px;
  border-radius: 4px;
  background: var(--bg-2);
  overflow: hidden;
}
.dl-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
  transition: width 0.25s;
}

/* 更新说明 */
.set-notes {
  margin-top: 14px;
  padding: 14px;
  border-radius: 16px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.notes-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 8px;
}
.notes-body {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}

/* 选项抽屉 */
.pick-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  backdrop-filter: blur(3px);
}
.pick {
  width: 100%;
  padding: 16px 14px calc(16px + env(safe-area-inset-bottom, 0px));
  border-radius: 20px 20px 0 0;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-bottom: 0;
}
.pick-title {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 8px;
}
.pick-list {
  display: flex;
  flex-direction: column;
}
.pick-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 6px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--text);
  font-size: 15px;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.pick-item.on {
  color: var(--accent);
  font-weight: 700;
}
.pick-cancel {
  width: 100%;
  height: 48px;
  margin-top: 10px;
  border: 0;
  border-radius: 14px;
  background: var(--bg);
  color: var(--text-2);
  font-size: 15px;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

/* ---------------- 插件市场抽屉 ---------------- */
.mk-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.55);
}
.mk-card {
  width: 100%;
  height: min(86vh, 820px);
  display: flex;
  flex-direction: column;
  padding: 18px 18px calc(16px + env(safe-area-inset-bottom));
  border-radius: 20px 20px 0 0;
  background: var(--bg-2);
  border-top: 1px solid var(--line);
}
/* 固定头部与触控目标；仅结果列表滚动。 */
.mk-tabs {
  flex: none;
}
.mk-tabs button {
  min-height: 42px;
  padding: 0 18px;
  font-size: 14px;
}
.mk-search {
  flex: none;
  height: 48px;
  margin: 0 0 12px;
  padding: 0 14px;
  font-size: 15px;
  border-radius: 10px;
}
.mk-head,
.mk-tip {
  flex: none;
}
.mk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.mk-head b {
  font-size: 15px;
}
.mk-close {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--bg-2);
  color: var(--text-2);
}
.mk-tip {
  margin: 0 0 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}
.mk-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mk-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.mk-main {
  flex: 1;
  min-width: 0;
}
.mk-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mk-title b {
  font-size: 13.5px;
}
.mk-ver.upd {
  color: #34d399;
}
.mk-acts {
  display: flex;
  gap: 6px;
  flex: none;
}
.mk-ver {
  font-size: 10.5px;
  color: var(--text-3);
}
.mk-desc {
  margin-top: 3px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-3);
}
.mk-btn {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  background: var(--accent);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}
.mk-btn.ghost {
  background: var(--bg-2);
  color: var(--text-2);
  font-weight: 500;
}
.mk-btn:disabled {
  opacity: 0.6;
}
.mk-err {
  padding: 14px 0;
  font-size: 12px;
  color: #ff8b9c;
  word-break: break-all;
}
.mk-empty {
  padding: 22px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
.mk-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
}
.mk-loading {
  padding: 10px 2px 4px;
  font-size: 12px;
  color: var(--text-3);
}
.mk-sk {
  height: 58px;
  border-radius: 12px;
  background: var(--bg-3);
  animation: mk-pulse 1.2s ease-in-out infinite;
}
@keyframes mk-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.85;
  }
}
/* 主题与壁纸（4.7+） */
.mtheme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  border: 1px solid var(--line, #262633);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2, #9b9ba8);
}
.mtheme.on {
  border-color: var(--accent, #a78bfa);
  color: var(--accent, #a78bfa);
}
.mtc {
  width: 34px;
  height: 34px;
  border-radius: 50%;
}
.mtn {
  font-size: 12px;
}
.msw {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
}
.msw.on {
  border-color: #fff;
}
.minput {
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--line, #262633);
  background: var(--panel, #13131b);
  color: var(--text-1, #ececf1);
  padding: 0 12px;
  font-size: 13px;
  margin-top: 8px;
  width: 100%;
  box-sizing: border-box;
}
.mwall-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
}
.mwall {
  aspect-ratio: 16 / 10;
  border: 0;
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  background: var(--panel, #13131b);
}
.mwall img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>

<style scoped>
/* 落雪式初始化状态徽标 */
.init-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 9px;
  font-size: 10.5px;
  font-weight: 600;
  vertical-align: 1px;
}
.init-badge.ok { color: #34d399; background: rgba(52, 211, 153, 0.14); }
.init-badge.bad { color: #f87171; background: rgba(248, 113, 113, 0.14); }
.init-badge.busy { color: var(--accent); background: rgba(167, 139, 250, 0.16); }
.init-badge.off { color: var(--text-3); background: rgba(255, 255, 255, 0.08); }

/* 市场 Tab 过滤 + 搜索框 */
.mk-tabs {
  display: flex;
  gap: 6px;
  padding: 0 14px 8px;
  overflow-x: auto;
}
.mk-tabs button {
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.mk-tabs button.on {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
}
.mk-search {
  margin: 0 14px 10px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text-1);
  font-size: 13px;
}
.mk-kind {
  margin-left: 6px;
  font-size: 10.5px;
  color: var(--text-3);
}
</style>
