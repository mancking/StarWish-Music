<script setup lang="ts">
import { computed, defineOptions, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { onPullRefresh, refreshDone } from '@/mobile/pull-refresh'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import { isVideoPlayed, markVideoPlayed, onVideoPlayed } from '@/utils/video-played'
import QRCode from 'qrcode'
import { useUiStore } from '@/stores/ui'
import type { MvItem } from '@shared/types'

/**
 * 移动端视频页 —— 模板级独立实现（非桌面网格缩放）。
 *
 * 与桌面差异：大号内联搜索框 + 热词横滑胶囊、视频 2 列封面卡（时长角标、
 * 播放量角标）、滚动到底自动加载更多——符合手机竖屏刷视频的肌肉记忆。
 */
defineOptions({ name: 'Mv' })

const router = useRouter()

const keyword = ref('')
const draft = ref('')
const list = ref<MvItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const page = ref(1)
const hasMore = ref(true)

const HOT = ['周杰伦', '演唱会', 'MV', 'Live', '音乐现场', '新歌', '经典老歌', '粤语']

/* ---------------- 视频源（B 站）登录 ---------------- */
const ui = useUiStore()
const bili = ref<{ loggedIn: boolean; uname?: string; mid?: string; avatar?: string }>({ loggedIn: false })
const loginOpen = ref(false)
const loginTab = ref<'qr' | 'pwd' | 'cookie'>('qr')
const qrImg = ref('')
const qrKey = ref('')
const qrUrl = ref('')
const qrStatus = ref('')
const pwdUser = ref('')
const pwdPass = ref('')
const pwdErr = ref('')
const pwdBusy = ref(false)
const ckText = ref('')
const ckErr = ref('')
const ckBusy = ref(false)
let qrTimer = 0

async function loadBiliStatus(): Promise<void> {
  try {
    bili.value = await call('bili:status')
  } catch { /* 未登录或通道不可用时保持默认 */ }
}

function openLogin(): void {
  loginOpen.value = true
  if (!bili.value.loggedIn && !qrImg.value) void startQrLogin()
}

function closeLogin(): void {
  loginOpen.value = false
  stopPoll()
}

function stopPoll(): void {
  if (qrTimer) {
    clearInterval(qrTimer)
    qrTimer = 0
  }
}

async function startQrLogin(): Promise<void> {
  loginTab.value = 'qr'
  pwdErr.value = ''
  ckErr.value = ''
  qrStatus.value = '正在获取二维码…'
  qrImg.value = ''
  stopPoll()
  try {
    const r = await call<{ url: string; key: string }>('bili:qr')
    qrKey.value = r.key
    qrUrl.value = r.url
    qrImg.value = await QRCode.toDataURL(r.url, { margin: 1, width: 220, color: { dark: '#111827', light: '#ffffff' } })
    qrStatus.value = '请使用哔哩哔哩 App 扫码，或点下方按钮拉起客户端'
    qrTimer = window.setInterval(() => void pollQr(), 2000)
  } catch (e: any) {
    qrStatus.value = e?.message || '二维码获取失败'
  }
}

function switchLoginTab(t: 'qr' | 'pwd' | 'cookie'): void {
  loginTab.value = t
  pwdErr.value = ''
  ckErr.value = ''
  if (t === 'qr' && !qrImg.value) void startQrLogin()
}

function openBiliApp(): void {
  if (!qrUrl.value) {
    ui.toast('二维码尚未生成', 'info')
    return
  }
  window.location.href = 'bilibili://browser?url=' + encodeURIComponent(qrUrl.value)
  qrStatus.value = '已尝试拉起哔哩哔哩，请在 App 中点击「确认登录」'
}

async function pollQr(): Promise<void> {
  if (!qrKey.value) return
  try {
    const r = await call<{ ok: boolean; status: string; message?: string }>('bili:poll', { key: qrKey.value })
    if (r.status) qrStatus.value = r.message || r.status
    if (r.ok) {
      stopPoll()
      await loadBiliStatus()
      ui.toast('视频源账号登录成功', 'success')
      setTimeout(() => (loginOpen.value = false), 600)
      void search(true)
    } else if (r.status === 'expired' || r.status === 'error') {
      stopPoll()
    }
  } catch (e: any) {
    qrStatus.value = e?.message || '轮询失败'
    stopPoll()
  }
}

async function pwdLogin(): Promise<void> {
  if (pwdBusy.value) return
  pwdErr.value = ''
  if (!pwdUser.value.trim() || !pwdPass.value) {
    pwdErr.value = '请输入账号与密码'
    return
  }
  pwdBusy.value = true
  try {
    await call('bili:passwordLogin', { username: pwdUser.value.trim(), password: pwdPass.value })
    await loadBiliStatus()
    ui.toast('视频源账号登录成功', 'success')
    pwdUser.value = ''
    pwdPass.value = ''
    loginOpen.value = false
    void search(true)
  } catch (e: any) {
    pwdErr.value = e?.message || '登录失败'
  } finally {
    pwdBusy.value = false
  }
}

async function ckLogin(): Promise<void> {
  if (ckBusy.value) return
  ckErr.value = ''
  if (!ckText.value.trim()) {
    ckErr.value = '请粘贴 Cookie 内容'
    return
  }
  ckBusy.value = true
  try {
    await call('bili:cookieLogin', { cookie: ckText.value.trim() })
    await loadBiliStatus()
    ui.toast('视频源账号登录成功', 'success')
    ckText.value = ''
    loginOpen.value = false
    void search(true)
  } catch (e: any) {
    ckErr.value = e?.message || '登录失败'
  } finally {
    ckBusy.value = false
  }
}

async function biliLogout(): Promise<void> {
  try {
    await call('bili:logout')
    await loadBiliStatus()
    ui.toast('已退出视频源账号', 'success')
    loginOpen.value = false
  } catch (e: any) {
    ui.toast(e?.message || '退出失败', 'error')
  }
}

/** 聚合模式：默认四平台聚合为一个信息流；胶囊只做本地来源过滤 */
const source = ref('all')
const SOURCE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'bili', label: 'B站' },
  { key: 'wy', label: '云村' },
  { key: 'qq', label: 'Q音' },
  { key: 'kg', label: '酷狗' },
  { key: 'kw', label: '酷我' },
]
const shown = computed(() =>
  source.value === 'all' ? list.value : list.value.filter(v => (v.source || 'bili') === source.value)
)
function sourceLabel(v: MvItem): string {
  const map: Record<string, string> = { bili: 'B站', wy: '云村', qq: 'Q音', kg: '酷狗', kw: '酷我' }
  return map[v.source || 'bili'] || v.source || 'B站'
}
function isSignedSource(v: MvItem): boolean {
  return v.source === 'kg' || v.source === 'kw'
}
function mvId(v: MvItem): string {
  return v.sourceId || v.bvid || ''
}
/** 播放足迹：播放过的视频隐去卡片播放按钮（v1.0.0 用户口径） */
const playedIds = ref<Set<string>>(new Set())
function vid(v: MvItem): string {
  return `${v.source || 'bili'}:${mvId(v)}`
}
function refreshPlayed(): void {
  playedIds.value = new Set(list.value.filter(v => isVideoPlayed(vid(v))).map(vid))
}
let offPlayed: (() => void) | null = null

function openMv(v: MvItem): void {
  markVideoPlayed(vid(v))
 // 带兜底元数据，Q音/酷狗/酷我 详情不含标题封面
  router.push({
    path: `/mv/${v.source || 'bili'}/${mvId(v)}`,
    query: {
      title: v.title || '',
      pic: v.pic || '',
      author: v.author || '',
      dur: String(v.durationSec || 0),
    },
  })
}
function switchSource(k: string): void {
  source.value = k
}

/**
 * 模块级结果缓存（切视频页加载耗时治理）：
 * 旧实现每次进入 /mv 都要重新聚合五源搜索（B站+网易+QQ+酷狗+酷我并发），
 * 真机弱网下首屏要等全部源返回 —— 表现为「切换视频页面后加载时间过长」。
 * 现在：同关键词 60s 内直接复用上次结果秒开，下拉刷新/主动搜索才强制重拉。
 */
const feedCache = new Map<string, { at: number; items: MvItem[] }>()
const FEED_TTL = 60_000

async function search(force = false): Promise<void> {
  const k = keyword.value.trim() || '音乐'
  if (!force) {
    const hit = feedCache.get(k)
    if (hit && Date.now() - hit.at < FEED_TTL && hit.items.length) {
      list.value = hit.items
      hasMore.value = true
      loading.value = false
      return
    }
  }
  loading.value = true
  error.value = ''
  page.value = 1
  hasMore.value = true
  try {
    const res = await call<MvItem[]>('music:mv', { keyword: k, page: 1, source: 'all' })
    list.value = res
    feedCache.set(k, { at: Date.now(), items: res })
    hasMore.value = res.length > 0
    if (!res.length) error.value = '没有找到相关视频，换个关键词试试'
  } catch (e: any) {
    error.value = e?.message || '视频加载失败'
  } finally {
    loading.value = false
  }
}

function submit(): void {
  keyword.value = draft.value.trim() || keyword.value
  void search(true)
}

function quick(k: string): void {
  draft.value = k
  keyword.value = k
  void search(true)
}

function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

/** 真机封面走 /swmedia/ 原生代理（B 站图片 CDN 有 Referer 防盗链，直连 403） */
function picUrl(u?: string): string {
  const s = String(u || '')
  if (!/^https?:\/\//i.test(s)) return s
  const cap: any = (globalThis as any).Capacitor
  if (cap?.isNativePlatform?.()) return `/swmedia/?u=${encodeURIComponent(s)}`
  return s
}

/** 滚动容器触底自动加载更多（观察哨兵元素） */
function watchSentinel(): void {
  const el = sentinel.value
  if (!el || observer) return
  observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) void loadMore()
  }, { rootMargin: '600px 0px' })
  observer.observe(el)
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value || loading.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await call<MvItem[]>('music:mv', { keyword: keyword.value.trim() || '音乐', page: next, source: 'all' })
    const seen = new Set(list.value.map(v => `${v.source || 'bili'}:${mvId(v)}`))
    const fresh = res.filter(v => !seen.has(`${v.source || 'bili'}:${mvId(v)}`))
    if (!fresh.length && !res.length) hasMore.value = false
    else {
      list.value = [...list.value, ...fresh]
      page.value = next
      if (!res.length) hasMore.value = false
    }
  } catch { /* 分页失败静默 */ } finally {
    loadingMore.value = false
  }
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
const PLACEHOLDER = computed(() => (keyword.value ? keyword.value : '搜索视频 / MV'))
const HOT_SUGGESTIONS = HOT

/* 下拉刷新：重新搜索当前关键词，不回首页、不闪白屏 */
const offPull = onPullRefresh(async () => {
  await search(true)
  refreshDone()
})
onBeforeUnmount(() => offPull())

onMounted(() => {
  void loadBiliStatus()
  void search()
  watchSentinel()
  offPlayed = onVideoPlayed(() => refreshPlayed())
})
watch(list, () => {
  void nextTick(watchSentinel)
  refreshPlayed()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopPoll()
  offPlayed?.()
})
</script>

<template>
  <div class="page m-mv">
    <!-- 搜索头：大输入框 + 热词 -->
    <div class="mv-search">
      <div class="mv-input">
        <Icon name="search" :size="17" class="mv-input-icon" />
        <input
          v-model="draft"
          type="search"
          :placeholder="PLACEHOLDER"
          enterkeyhint="search"
          @keydown.enter="submit"
        />
        <button class="mv-go" @click="submit">搜索</button>
      </div>
      <div class="mv-hot">
        <button v-for="k in HOT_SUGGESTIONS" :key="k" class="mv-hot-tag" @click="quick(k)">{{ k }}</button>
      </div>
 <!-- 源 Tab（.10） -->
      <div class="mv-src-tabs">
        <button
          v-for="t in SOURCE_TABS"
          :key="t.key"
          :class="{ on: source === t.key }"
          @click="switchSource(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
 <!-- 视频源登录入口 -->
      <div class="mv-account">
        <button class="mv-acc-btn" :class="{ on: bili.loggedIn }" @click="openLogin">
          <Icon :name="bili.loggedIn ? 'user' : 'qr'" :size="14" />
          <span>{{ bili.loggedIn ? (bili.uname || '已登录') : '登录视频源' }}</span>
        </button>
        <span class="mv-acc-tip">{{ bili.loggedIn ? '已解锁高清晰度' : '登录后可解锁更高清晰度' }}</span>
      </div>
    </div>

    <!-- 骨架 -->
    <div v-if="loading" class="mv-grid">
      <div v-for="i in 6" :key="i" class="sk" style="height: 150px; border-radius: 14px" />
    </div>

    <div v-else-if="error && !list.length" class="empty" style="padding: 60px 16px">
      <Icon name="video" :size="32" :stroke="1.3" />
      <div class="empty-title">{{ error }}</div>
      <button class="btn primary" style="margin-top: 12px" @click="search(true)">重试</button>
    </div>

    <!-- 视频卡：2 列 -->
    <template v-else>
      <div class="mv-grid">
        <button v-for="v in shown" :key="`${v.source || 'bili'}:${mvId(v)}`" class="mv-card" @click="openMv(v)">
          <div class="mv-cover-wrap">
            <Cover :src="picUrl(v.pic)" :size="180" radius="12" class="mv-cover" />
            <span class="mv-badge src">{{ sourceLabel(v) }}</span>
            <span v-if="v.duration" class="mv-badge">{{ v.duration }}</span>
            <span v-if="v.play" class="mv-badge play"><Icon v-if="!playedIds.has(vid(v))" name="play" :size="10" />{{ fmtPlay(v.play) }}</span>
          </div>
          <div class="mv-title">{{ v.title }}</div>
          <div class="mv-sub">{{ v.author || '' }}</div>
        </button>
      </div>
      <div v-if="loadingMore" class="mv-more">加载中…</div>
      <div v-else-if="!hasMore && list.length" class="mv-more">没有更多了</div>
      <div ref="sentinel" style="height: 1px" />
    </template>



    <!-- 视频源登录面板：扫码 / 账号密码 / Cookie -->
    <div v-if="loginOpen" class="lg-mask" @click.self="closeLogin">
      <div class="lg-card">
        <div class="lg-head">
          <b>{{ bili.loggedIn ? '视频源账号' : '登录视频源' }}</b>
          <button class="lg-close" @click="closeLogin"><Icon name="close" :size="16" /></button>
        </div>

        <div v-if="bili.loggedIn" class="lg-user">
          <div class="lg-avatar"><Icon name="user" :size="20" /></div>
          <div class="lg-user-info">
            <b>{{ bili.uname || '已登录' }}</b>
            <span>已解锁高清晰度</span>
          </div>
          <button class="lg-btn ghost" @click="biliLogout"><Icon name="logout" :size="14" />退出</button>
        </div>

        <template v-else>
          <div class="lg-tabs">
            <button class="lg-tab" :class="{ on: loginTab === 'qr' }" @click="switchLoginTab('qr')">扫码</button>
            <button class="lg-tab" :class="{ on: loginTab === 'pwd' }" @click="switchLoginTab('pwd')">账号密码</button>
            <button class="lg-tab" :class="{ on: loginTab === 'cookie' }" @click="switchLoginTab('cookie')">Cookie</button>
          </div>

          <div v-if="loginTab === 'qr'" class="lg-pane">
            <div class="lg-qr">
              <img v-if="qrImg" :src="qrImg" alt="视频源登录二维码" />
              <div v-else class="lg-qr-sk" />
            </div>
            <p class="lg-status">{{ qrStatus }}</p>
            <button class="lg-btn" @click="openBiliApp"><Icon name="external" :size="14" />拉起哔哩哔哩确认登录</button>
            <button class="lg-btn ghost" @click="startQrLogin">刷新二维码</button>
          </div>

          <div v-else-if="loginTab === 'pwd'" class="lg-pane">
            <input v-model="pwdUser" class="lg-input" placeholder="手机号 / 邮箱" autocomplete="username" />
            <input v-model="pwdPass" class="lg-input" type="password" placeholder="密码" autocomplete="current-password" />
            <p v-if="pwdErr" class="lg-err">{{ pwdErr }}</p>
            <button class="lg-btn" :disabled="pwdBusy" @click="pwdLogin">{{ pwdBusy ? '登录中…' : '登录' }}</button>
          </div>

          <div v-else class="lg-pane">
            <textarea v-model="ckText" class="lg-textarea" placeholder="粘贴浏览器 Cookie（含 SESSDATA）" />
            <p v-if="ckErr" class="lg-err">{{ ckErr }}</p>
            <button class="lg-btn" :disabled="ckBusy" @click="ckLogin">{{ ckBusy ? '登录中…' : '登录' }}</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-search {
  padding-top: 6px;
}
.mv-input {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 6px 0 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg-2);
}
.mv-input-icon {
  color: var(--text-3);
}
.mv-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 14.5px;
  outline: none;
}
.mv-go {
  flex: none;
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 11px;
  background: var(--accent);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}
.mv-hot {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 10px -16px 2px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.mv-hot::-webkit-scrollbar {
  display: none;
}
.mv-hot-tag {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.mv-hot-tag:active {
  filter: brightness(1.2);
}

.mv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
  margin-top: 14px;
}
.mv-card {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.mv-card:active .mv-cover {
  transform: scale(0.97);
  transition: transform 0.12s;
}
.mv-cover-wrap {
  position: relative;
}
.mv-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10.5px;
}
.mv-badge.play {
  left: 6px;
  right: auto;
}
.mv-badge.src {
  left: 6px;
  right: auto;
  bottom: auto;
  top: 6px;
}
.mv-card.dim .mv-cover {
  filter: brightness(0.6);
}
.mv-src-tabs {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mv-src-tabs::-webkit-scrollbar {
  display: none;
}
.mv-src-tabs button {
  flex: none;
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
}
.mv-src-tabs button.on {
  background: var(--accent-soft, rgba(167, 139, 250, 0.16));
  border-color: var(--accent);
  color: var(--accent);
}
.mv-title {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mv-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mv-more {
  text-align: center;
  padding: 18px 0 6px;
  font-size: 12px;
  color: var(--text-3);
}
/* 视频源登录入口 */
.mv-account {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.mv-acc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
}
.mv-acc-btn.on {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--accent);
}
.mv-acc-tip {
  font-size: 11px;
  color: var(--text-3);
}
/* 登录面板 */
.lg-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.lg-card {
  width: 100%;
  max-height: 82vh;
  overflow-y: auto;
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  border-radius: 20px 20px 0 0;
  background: var(--bg-2);
  border-top: 1px solid var(--line);
}
.lg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.lg-head b {
  font-size: 15px;
}
.lg-close {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--bg-2);
  color: var(--text-2);
}
.lg-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: var(--bg-2);
}
.lg-avatar {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  background: var(--bg-3, rgba(255, 255, 255, 0.06));
  color: var(--text-2);
}
.lg-user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.lg-user-info b {
  font-size: 14px;
}
.lg-user-info span {
  font-size: 11.5px;
  color: var(--text-3);
}
.lg-tabs {
  display: flex;
  gap: 6px;
  padding: 3px;
  border-radius: 12px;
  background: var(--bg-2);
  margin-bottom: 14px;
}
.lg-tab {
  flex: 1;
  height: 34px;
  border-radius: 9px;
  font-size: 12.5px;
  color: var(--text-2);
}
.lg-tab.on {
  background: var(--bg-2);
  color: var(--text);
  font-weight: 600;
}
.lg-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lg-qr {
  align-self: center;
  width: 190px;
  height: 190px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}
.lg-qr img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.lg-qr-sk {
  width: 100%;
  height: 100%;
  background: linear-gradient(110deg, #eee 30%, #f6f6f6 50%, #eee 70%);
}
.lg-status {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}
.lg-input,
.lg-textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text);
  font-size: 13.5px;
  padding: 0 12px;
  height: 44px;
}
.lg-textarea {
  height: 96px;
  padding: 10px 12px;
  resize: none;
}
.lg-err {
  margin: 0;
  font-size: 12px;
  color: #f87171;
}
.lg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
}
.lg-btn.ghost {
  background: var(--bg-2);
  color: var(--text-2);
  font-weight: 500;
}
.lg-btn:disabled {
  opacity: 0.6;
}
</style>
