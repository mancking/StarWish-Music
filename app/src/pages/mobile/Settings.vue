<script setup lang="ts">
import { computed, defineOptions, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Toggle from '@/components/Toggle.vue'
import { call, on } from '@/api'
import { checkUpdate, type UpdateInfo } from '@/utils/update-check'
import { defsOf, type SettingCat, type SettingDef } from '@/settings/schema'
import { useUiStore } from '@/stores/ui'
import { usePlayerStore } from '@/stores/player'
import { useDownloadStore } from '@/stores/download'
import type { AppSettings, SourceInfo } from '@shared/types'

/**
 * 移动端设置页 —— 模板级重写（v2.3.4）。
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

type Group = 'appearance' | 'playback' | 'lyric' | 'download' | 'sources' | 'account' | 'network' | 'about'
/** '' = 一级分组列表；否则为该分组二级页 */
const group = ref<Group | ''>('')

const groups: { key: Group; label: string; desc: string; icon: string }[] = [
  { key: 'appearance', label: '外观', desc: '主题、强调色、列表密度', icon: 'palette' },
  { key: 'playback', label: '播放', desc: '音质、倍速、播放模式', icon: 'play-circle' },
  { key: 'lyric', label: '歌词', desc: '字号、偏移、字体', icon: 'lyric' },
  { key: 'download', label: '下载', desc: '下载音质与保存位置', icon: 'download' },
  { key: 'sources', label: '音源与插件', desc: '音源开关、插件市场', icon: 'plug' },
  { key: 'account', label: '账号', desc: 'B 站登录（视频源）', icon: 'user' },
  { key: 'network', label: '网络与缓存', desc: '代理、缓存上限', icon: 'wifi' },
  { key: 'about', label: '关于与更新', desc: '版本、检查更新', icon: 'info' },
]

const settings = computed(() => ui.settings)

/* ---------------- 二级页：schema 驱动的设置项 ---------------- */
function defsOfGroup(g: Group): SettingDef[] {
  const map: Record<Group, SettingCat> = {
    appearance: 'appearance',
    playback: 'playback',
    lyric: 'lyric',
    download: 'download',
    sources: 'sources',
    account: 'shortcuts',
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
async function loadSources(): Promise<void> {
  try {
    sources.value = await call<SourceInfo[]>('sources:list')
  } catch {
    sources.value = []
  }
}

async function toggleSource(s: SourceInfo): Promise<void> {
  try {
    sources.value = await call<SourceInfo[]>('sources:toggle', { file: s.file, enabled: !s.enabled })
  } catch (e: any) {
    ui.toast(e.message, 'error')
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
onMounted(() => {
  void loadAppInfo()
  void loadSources()
  offProgress = on('update:progress', (p: any) => {
    dlPercent.value = Number(p?.percent || 0)
    dlReceived.value = Number(p?.received || 0)
    dlTotal.value = Number(p?.total || 0)
  })
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

      <!-- 音源与插件 -->
      <section v-else-if="group === 'sources'" class="set-group">
        <div class="set-card">
          <div v-for="s in sources" :key="s.file" class="set-item">
            <div class="it-meta">
              <span class="it-label">{{ s.name }}</span>
              <span class="it-desc">{{ s.loadError ? s.loadError : s.description || s.platforms?.join(' · ') || '音源脚本' }}</span>
            </div>
            <Toggle :model-value="s.enabled" @update:model-value="() => toggleSource(s)" />
          </div>
          <div v-if="!sources.length" class="set-empty">音源列表加载中…</div>
        </div>
        <div class="set-card">
          <button class="set-item link" @click="router.push('/discover')">
            <div class="it-meta">
              <span class="it-label">插件市场</span>
              <span class="it-desc">安装与更新 MusicFree 协议插件</span>
            </div>
            <Icon name="chevron-right" :size="16" class="set-arrow" />
          </button>
        </div>
      </section>

      <!-- 账号 -->
      <section v-else-if="group === 'account'" class="set-group">
        <div class="set-card">
          <div class="set-item">
            <div class="it-meta">
              <span class="it-label">B 站账号</span>
              <span class="it-desc">用于 MV / 视频源的高清晰度与会员内容</span>
            </div>
            <span class="it-value static">在「视频」页登录</span>
          </div>
        </div>
        <p class="set-tip">星河音乐不收集个人信息，账号信息仅保存在本机。</p>
      </section>

      <!-- 网络与缓存 -->
      <section v-else-if="group === 'network'" class="set-group">
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
</style>
