<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import Icon from '@/components/Icon.vue'
import Toggle from '@/components/Toggle.vue'
import Modal from '@/components/Modal.vue'
import Slider from '@/components/Slider.vue'
import { call, isDesktop } from '@/api'
import { checkUpdate, type UpdateInfo } from '@/utils/update-check'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { platformLabel } from '@/utils/labels'
import type { AppSettings, SourceInfo } from '@shared/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()

type Cat = 'appearance' | 'playback' | 'lyric' | 'sources' | 'local' | 'cache' | 'shortcuts' | 'about'
const cat = ref<Cat>('appearance')

const cats: { key: Cat; label: string; icon: string }[] = [
  { key: 'appearance', label: '外观主题', icon: 'palette' },
  { key: 'playback', label: '播放', icon: 'play-circle' },
  { key: 'lyric', label: '歌词', icon: 'lyric' },
  { key: 'sources', label: '音源与插件', icon: 'plug' },
  { key: 'local', label: '本地音乐', icon: 'folder' },
  { key: 'cache', label: '网络与缓存', icon: 'database' },
  { key: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { key: 'about', label: '关于', icon: 'info' },
]

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
const restoring = ref(false)
const dataMoving = ref(false)
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
    const r = await call<{ file: string; sources: SourceInfo[] }>('sources:import', {
      url: importUrl.value.trim() || undefined,
      content: importText.value || undefined,
    })
    sources.value = r.sources
    importOpen.value = false
    importUrl.value = ''
    importText.value = ''
    ui.toast(`音源「${r.file}」导入成功`, 'success')
  } catch (e: any) {
    importError.value = e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

const cachePath = computed(() => setting.value.cacheDir || `${appInfo.value?.userData || ''}\\cache`)
const coverPath = computed(() => setting.value.coverDir || `${cachePath.value}\\covers`)
const mediaPath = computed(() => setting.value.mediaDir || `${cachePath.value}\\media`)
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
    const cur = String(appInfo.value?.version || '2.0.0')
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
  await Promise.all([loadSources(), loadMeta()])
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
        </section>

        <!-- 播放 -->
        <section v-else-if="cat === 'playback'">
          <h2>播放</h2>
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
            <div class="label"><b>当前歌词来源</b><span>来自音源插件或平台官方接口</span></div>
            <span class="val">{{ player.lyric?.source || '暂无' }}</span>
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
              <button class="btn primary sm" @click="importOpen = true"><Icon name="plus" :size="14" />导入音源</button>
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
                <button class="icon-btn" title="查看源码" @click="viewCode(s)"><Icon name="edit" :size="15" /></button>
                <button class="icon-btn" title="移除" @click="deleteTarget = s"><Icon name="trash" :size="15" /></button>
                <Toggle :model-value="s.enabled" @update:model-value="() => toggleSource(s)" />
              </div>
            </div>
            <div v-if="!sources.length" class="empty" style="padding: 30px">
              <div class="empty-desc">没有找到音源脚本，请检查安装目录下的 sources 文件夹</div>
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
        </section>

        <!-- 快捷键 -->
        <section v-else-if="cat === 'shortcuts'">
          <h2>快捷键</h2>
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
              <p>版本 {{ appInfo?.version || '2.0.0' }} · Electron {{ appInfo?.electron || '-' }}</p>
              <p>Chrome {{ appInfo?.chrome || '-' }} · Node {{ appInfo?.node || '-' }}</p>
              <p class="muted">多音源聚合播放器，音源脚本可自由导入替换。所有音乐版权归各平台与版权方所有，仅供个人学习与试听。</p>
            </div>
          </div>
          <div class="row">
            <div class="label"><b>本地数据库</b><span>歌曲 / 歌单 / 收藏 / 播放历史</span></div>
            <span class="val">{{ appInfo?.db?.songs || 0 }} 首 · {{ fmtBytes(appInfo?.db?.size || 0) }}</span>
          </div>
          <div class="row">
            <div class="label"><b>日志目录</b><span>出现问题时可将日志反馈给开发者</span></div>
            <button class="btn sm ghost" @click="openDataDir"><Icon name="folder-open" :size="14" />打开数据目录</button>
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
    <Modal v-model="importOpen" title="导入音源" :width="520">
      <p class="modal-tip">支持 lx-music 协议 JS 音源，可从在线链接导入或选择本地文件。</p>
      <label class="field-label">音源链接</label>
      <input v-model="importUrl" class="input" placeholder="https://example.com/source.js" spellcheck="false" @input="importText = ''" />
      <label class="field-label">或选择本地 JS 文件</label>
      <input type="file" accept=".js,text/javascript" class="file" @change="onFile" />
      <div v-if="importText" class="file-ok"><Icon name="check" :size="13" />已读取脚本（{{ (importText.length / 1024).toFixed(1) }} KB）</div>
      <div v-if="importError" class="err"><Icon name="info" :size="13" />{{ importError }}</div>
      <template #footer>
        <button class="btn ghost" @click="importOpen = false">取消</button>
        <button class="btn primary" :disabled="importing" @click="doImport">{{ importing ? '导入中…' : '导入' }}</button>
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
  padding-bottom: 18px;
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
