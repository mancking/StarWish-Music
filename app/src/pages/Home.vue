<script lang="ts">
// 模块级缓存：跨实例存活（KeepAlive 回收后重挂载也能秒开），仅进程内有效
let feedCache: any = null
</script>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import SongList from '@/components/SongList.vue'
import PlaylistCard from '@/components/PlaylistCard.vue'
import { call, isDesktop } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'
import brand from '@/assets/brand-cover.png'

const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()
const library = useLibraryStore()

const loading = ref(true)
const error = ref('')
const feed = ref<any>(null)
const refreshing = ref(false)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const dateText = computed(() => {
  const d = new Date()
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${week}`
})

const daily = computed<Song[]>(() => feed.value?.daily || [])
const continueList = computed<Song[]>(() => feed.value?.continueListening || [])
const playlists = computed<any[]>(() => feed.value?.playlists || [])
const toplists = computed<any[]>(() => feed.value?.toplists || [])
const moods = computed<any[]>(() => feed.value?.moods || [])
const newSongs = computed<Song[]>(() => feed.value?.newSongs || [])
const onRepeat = computed<Song[]>(() => feed.value?.onRepeat || [])
const memory = ref<any>(null)
const podcasts = computed<any[]>(() => feed.value?.podcasts || [])

/* ---------------- 私人电台 ---------------- */
const radio = ref<{ songs: Song[]; seeds: string[] }>({ songs: [], seeds: [] })
const radioLoading = ref(false)

async function loadRadio(force = false): Promise<void> {
  if (radioLoading.value) return
  radioLoading.value = true
  try {
    const r = await call<{ songs: Song[]; seeds: string[] }>('radio:build', { force, size: 60 })
    radio.value = { songs: r.songs || [], seeds: r.seeds || [] }
  } catch (e: any) {
    // 电台失败时退回「你在循环」，保证区块不至于空白
    if (!radio.value.songs.length) radio.value = { songs: onRepeat.value, seeds: [] }
  } finally {
    radioLoading.value = false
  }
}

function playRadio(): void {
  if (!radio.value.songs.length) {
    void loadRadio(true).then(() => {
      if (radio.value.songs.length) player.playSongs(radio.value.songs, 0)
    })
    return
  }
  void player.playSongs(radio.value.songs, 0)
}

function shuffleRadio(): void {
  void loadRadio(true).then(() => {
    if (radio.value.songs.length) {
      player.playSongs(radio.value.songs, 0)
      ui.toast('已换一批电台', 'success', 1600)
    }
  })
}

async function load(force = false): Promise<void> {
  // 后台缓存：有缓存先秒开再静默刷新；下拉刷新（force）直接重拉
  if (!force && feedCache) {
    feed.value = feedCache
    loading.value = false
    void call('home:feed', { force: false })
      .then((f: any) => {
        feedCache = f
        feed.value = f
      })
      .catch(() => {
        /* 静默刷新失败：保留缓存内容 */
      })
    return
  }
  if (force) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    const [f, m] = await Promise.all([call('home:feed', { force }), call('music:memory').catch(() => null)])
    feed.value = f
    feedCache = f
    memory.value = m
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function playDaily(): void {
  if (daily.value.length) void player.playSongs(daily.value, 0)
  else ui.toast('每日推荐还在生成中，请稍候', 'info')
}

function openPlaylist(pl: any): void {
  router.push({ path: `/playlist/${pl.id}`, query: { src: pl.source || 'wy', name: pl.name } })
}

async function playPlaylist(pl: any): Promise<void> {
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:playlist', { id: pl.id, source: pl.source || 'wy' })
    if (!r.songs.length) throw new Error('歌单为空')
    await player.playSongs(r.songs, 0)
    ui.toast(`正在播放：${r.name}`, 'success', 1800)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function playToplist(card: any): Promise<void> {
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:toplist', { platform: card.platform, id: card.id })
    if (!r.songs.length) throw new Error('榜单暂无数据')
    await player.playSongs(r.songs, 0)
    ui.toast(`正在播放：${r.name}`, 'success', 1800)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

function openToplist(card: any): void {
  if (!card?.platform || !card?.id) return
  router.push({ path: `/toplist/${card.platform}/${card.id}` })
}

function playFrom(card: any, index: number): void {
  if (!card.songs?.length) return
  void player.playSongs(card.songs, index)
}

function openMood(m: any): void {
  router.push({ path: '/discover', query: { tab: 'playlists', cat: m.cat } })
}

function openPodcast(p: any): void {
  router.push({
    path: `/podcast/${p.id}`,
    query: { feed: p.feed || '', name: p.name, pic: p.pic, author: p.author },
  })
}

onMounted(() => {
  void load()
  void loadRadio()
})
</script>

<template>
  <div class="page home">
    <!-- 加载骨架 -->
    <div v-if="loading" class="skeleton-page">
      <div class="sk" style="height: 196px; border-radius: 20px" />
      <div class="sk-row">
        <div v-for="i in 5" :key="i" class="sk" style="height: 120px; border-radius: 12px" />
      </div>
      <div class="sk" style="height: 22px; width: 180px; margin: 28px 0 16px" />
      <div class="sk-row">
        <div v-for="i in 6" :key="i" class="sk" style="height: 180px; border-radius: 12px" />
      </div>
    </div>

    <div v-else-if="error" class="empty" style="padding: 90px 20px">
      <Icon name="wifi" :size="36" :stroke="1.3" />
      <div class="empty-title">内容加载失败</div>
      <div class="empty-desc">{{ error }}</div>
      <button class="btn primary" style="margin-top: 8px" @click="load(true)">重新加载</button>
    </div>

    <template v-else>
      <!-- Hero -->
      <section class="hero">
        <img class="hero-art" :src="brand" alt="星河" draggable="false" />
        <div class="hero-shade" />
        <div class="hero-content">
          <div class="kicker">{{ dateText }}</div>
          <h1>{{ greeting }}，欢迎回来</h1>
          <p class="sub">从星河里捞一首歌，陪你度过此刻。</p>
          <div class="hero-actions">
            <button class="btn primary lg" @click="playDaily">
              <Icon name="play" :size="15" />播放每日推荐
            </button>
            <button class="btn ghost lg" @click="router.push('/favorites')">
              <Icon name="heart" :size="15" />我喜欢的音乐
            </button>
            <button class="btn ghost lg" @click="router.push('/discover')">
              <Icon name="compass" :size="15" />发现音乐
            </button>
          </div>
          <div class="hero-stats">
            <div><b>{{ daily.length || 30 }}</b><span>每日推荐</span></div>
            <i />
            <div><b>{{ feed?.totalToplists || 0 }}</b><span>榜单</span></div>
            <i />
            <div><b>6</b><span>音源平台</span></div>
          </div>
        </div>
        <button class="refresh" :class="{ spin: refreshing }" title="刷新推荐" @click="load(true)">
          <Icon name="refresh" :size="15" />
        </button>
      </section>

      <!-- 继续收听 -->
      <section v-if="continueList.length" class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="clock" :size="17" />继续收听</div>
            <div class="section-sub">接着上次的地方继续</div>
          </div>
          <span class="section-more" @click="router.push('/history')">全部历史<Icon name="chevron-right" :size="13" /></span>
        </div>
        <div class="recent-row">
          <div
            v-for="(s, i) in continueList"
            :key="s.id"
            class="recent-card"
            @click="player.playSongs(continueList, i)"
          >
            <Cover :src="s.pic" :alt="s.name" :size="54" :radius="10" cover="1" />
            <div class="rc-meta">
              <div class="rc-name ellipsis">{{ s.name }}</div>
              <div class="rc-sub ellipsis">{{ s.singer }}</div>
            </div>
            <Icon name="play-circle" :size="17" class="rc-play" />
          </div>
        </div>
      </section>

      <!-- 推荐歌单 -->
      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="sparkles" :size="17" />推荐歌单</div>
            <div class="section-sub">来自在线音源的精选歌单，点开即可播放</div>
          </div>
          <span class="section-more" @click="router.push({ path: '/discover', query: { tab: 'playlists' } })">
            更多歌单<Icon name="chevron-right" :size="13" />
          </span>
        </div>
        <div v-if="playlists.length" class="grid-cards">
          <PlaylistCard
            v-for="pl in playlists"
            :key="pl.id"
            :playlist="pl"
            @open="openPlaylist(pl)"
            @play="playPlaylist(pl)"
          />
        </div>
        <div v-else class="empty" style="padding: 26px">
          <div class="empty-desc">推荐歌单暂时不可用，请检查网络或稍后重试</div>
        </div>
      </section>

      <!-- 每日推荐 -->
      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="star" :size="17" />每日推荐</div>
            <div class="section-sub">根据你的口味每天更新，共 {{ daily.length }} 首</div>
          </div>
          <button class="btn sm" @click="playDaily"><Icon name="play" :size="13" />播放全部</button>
        </div>
        <SongList :songs="daily.slice(0, 12)" :show-album="true" empty-text="推荐正在生成" empty-desc="多听几首歌，推荐会更懂你" />
      </section>

      <!-- 私人电台 -->
      <section v-if="radio.songs.length" class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="radio" :size="17" />私人电台</div>
            <div class="section-sub">
              {{ radio.seeds.length ? `根据 ${radio.seeds.join('、')} 的口味，持续为你播放` : '按你的收听口味，持续为你播放' }}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex:none">
            <button class="btn sm ghost" :disabled="radioLoading" @click="shuffleRadio">
              <Icon name="refresh" :size="13" />{{ radioLoading ? '生成中…' : '换一批' }}
            </button>
            <button class="btn sm" @click="playRadio"><Icon name="play" :size="13" />开始收听</button>
          </div>
        </div>
        <SongList :songs="radio.songs.slice(0, 8)" :show-album="false" empty-text="多听几首歌，这里会出现你的私人电台" />
      </section>

      <!-- 音乐回忆 -->
      <section v-if="memory && memory.total > 0" class="section">
        <div class="memory-card">
          <div class="mem-left">
            <div class="mem-kicker">音乐回忆</div>
            <h3>你已经听过了 <b>{{ memory.total }}</b> 首歌</h3>
            <p>跨越 {{ memory.days }} 天 · 收藏 {{ library.favoriteCount }} 首 · 本地 {{ library.localCount }} 首</p>
            <div v-if="memory.topSingers?.length" class="mem-singers">
              <span v-for="s in memory.topSingers.slice(0, 4)" :key="s.name" class="chip">
                {{ s.name }} · {{ s.count }}
              </span>
            </div>
          </div>
          <div class="mem-right">
            <Icon name="sparkles" :size="54" :stroke="1.1" />
          </div>
        </div>
      </section>

      <!-- 排行榜 -->
      <section v-if="toplists.length" class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="gauge" :size="17" />热门榜单</div>
            <div class="section-sub">实时更新的平台榜单</div>
          </div>
          <span class="section-more" @click="router.push({ path: '/discover', query: { tab: 'toplists' } })">
            全部榜单<Icon name="chevron-right" :size="13" />
          </span>
        </div>
        <div class="toplist-grid">
          <div v-for="card in toplists" :key="card.id" class="top-card">
            <div class="tc-head">
              <button class="tc-title tc-title-btn" :title="`打开榜单：${card.name}`" @click="openToplist(card)">
                <span class="tc-badge"><Icon name="zap" :size="12" /></span>
                <span class="ellipsis">{{ card.name }}</span>
                <Icon name="chevron-right" :size="12" class="tc-more" />
              </button>
              <button class="icon-btn tiny" title="播放全部" @click="playToplist(card)"><Icon name="play" :size="13" /></button>
            </div>
            <div
              v-for="(s, i) in card.songs.slice(0, 4)"
              :key="s.id"
              class="tc-row"
              @click="playFrom(card, i)"
            >
              <span class="tc-idx">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="tc-name ellipsis">{{ s.name }}</span>
              <span class="tc-singer ellipsis">{{ s.singer }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 心情 -->
      <section v-if="moods.length" class="section">
        <div class="section-head">
          <div>
            <div class="section-title"><Icon name="heart" :size="17" />心情与活动</div>
            <div class="section-sub">按此刻的心情，挑一张歌单</div>
          </div>
        </div>
        <div class="mood-grid">
          <button v-for="(m, i) in moods" :key="m.key" class="mood" :class="`m${i % 8}`" @click="openMood(m)">
            <img v-if="m.cover" :src="m.cover" class="mood-bg" alt="" loading="lazy" />
            <div class="mood-mask" />
            <div class="mood-info">
              <span class="mood-name">{{ m.name }}</span>
              <span class="mood-desc">{{ m.desc }}</span>
            </div>
            <Icon :name="m.icon || 'sparkles'" :size="30" class="mood-icon" />
          </button>
        </div>
      </section>

      <!-- 新歌 + 播客 -->
      <section class="section two-col">
        <div class="col-main">
          <div class="section-head">
            <div>
              <div class="section-title"><Icon name="music" :size="17" />新歌速递</div>
              <div class="section-sub">刚刚上架的新声音</div>
            </div>
            <span class="section-more" @click="router.push(isDesktop ? { path: '/discover', query: { tab: 'new' } } : { path: '/new' })">
              全部新歌<Icon name="chevron-right" :size="13" />
            </span>
          </div>
          <SongList :songs="newSongs.slice(0, 12)" :show-album="false" :show-cover="true" empty-text="暂无新歌" />
        </div>
        <div class="col-side">
          <div class="section-head">
            <div>
              <div class="section-title"><Icon name="microphone" :size="17" />播客精选</div>
              <div class="section-sub">点开即可在播放器内收听</div>
            </div>
          </div>
          <div class="podcast-list">
            <button v-for="p in podcasts" :key="p.id" class="podcast" @click="openPodcast(p)">
              <Cover :src="p.pic" :alt="p.name" :size="46" :radius="10" />
              <div class="pc-meta">
                <div class="pc-name clamp-2">{{ p.name }}</div>
                <div class="pc-sub ellipsis">{{ p.author }}</div>
              </div>
              <Icon name="play" :size="14" class="pc-ext" />
            </button>
            <div v-if="!podcasts.length" class="empty" style="padding: 24px">
              <div class="empty-desc">播客源暂不可用</div>
            </div>
          </div>
        </div>
      </section>

      <div class="foot-note">
        <Icon name="sparkles" :size="13" />
        <span>星河音乐 · 所有歌曲来自公开音源，仅供个人学习与试听</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home {
  padding-top: 12px;
}
.hero {
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  min-height: 196px;
  display: flex;
  align-items: center;
  padding: 26px 30px;
  background: linear-gradient(120deg, #141024, #1b1233);
  border: 1px solid var(--line);
  isolation: isolate;
}
.hero-art {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  width: auto;
  opacity: 0.85;
  z-index: -2;
  mask-image: linear-gradient(90deg, transparent, #000 42%);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 42%);
}
.hero-shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(90deg, rgba(10, 10, 18, 0.94) 0%, rgba(10, 10, 18, 0.6) 48%, rgba(10, 10, 18, 0.05) 100%);
}
.hero-content {
  position: relative;
  max-width: 58%;
}
.kicker {
  font-size: 11px;
  letter-spacing: 1.4px;
  color: #b9a7ff;
  margin-bottom: 8px;
  text-transform: uppercase;
}
.hero h1 {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
}
.hero .sub {
  margin-top: 7px;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.62);
}
.hero-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.btn.lg {
  height: 38px;
  padding: 0 18px;
  border-radius: 11px;
  font-size: 13px;
}
.btn.ghost.lg {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.btn.ghost.lg:hover {
  background: rgba(255, 255, 255, 0.17);
}
.hero-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 20px;
}
.hero-stats i {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.14);
}
.hero-stats div {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10.5px;
}
.hero-stats b {
  font-size: 16px;
  color: #fff;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.refresh {
  position: absolute;
  right: 18px;
  top: 16px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.08);
}
.refresh:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}
.refresh.spin :deep(svg) {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.recent-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.recent-card {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: background 0.18s, transform 0.18s;
  min-width: 0;
}
.recent-card:hover {
  background: var(--panel-2);
  transform: translateY(-1px);
}
.rc-meta {
  min-width: 0;
  flex: 1;
}
.rc-name {
  font-size: 12.5px;
  font-weight: 500;
}
.rc-sub {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}
.rc-play {
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.18s;
}
.recent-card:hover .rc-play {
  opacity: 1;
  color: var(--accent);
}

.grid-cards {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 18px 16px;
}

.toplist-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.top-card {
  padding: 12px;
  border-radius: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
}
.tc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.tc-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
}
.tc-title-btn {
  flex: 1;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 7px;
  transition: color 0.15s;
}
.tc-title-btn:hover {
  color: var(--accent);
}
.tc-more {
  flex: none;
  color: var(--text-3);
}
.tc-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  flex: none;
}
.tc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 7px;
  cursor: default;
  font-size: 12px;
}
.tc-row:hover {
  background: var(--hover);
}
.tc-idx {
  color: var(--text-3);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  width: 16px;
}
.tc-name {
  flex: 1.6;
  min-width: 0;
}
.tc-singer {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-3);
  text-align: right;
}

.mood-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.mood {
  position: relative;
  height: 92px;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 13px 14px;
  text-align: left;
  color: #fff;
  background: linear-gradient(135deg, #3b2f63, #1c1930);
  transition: transform 0.2s var(--ease), box-shadow 0.2s;
}
.mood:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 28px -16px rgba(0, 0, 0, 0.7);
}
.mood.m1 {
  background: linear-gradient(135deg, #2f4858, #1b2b33);
}
.mood.m2 {
  background: linear-gradient(135deg, #4a3b2a, #241d15);
}
.mood.m3 {
  background: linear-gradient(135deg, #3f2a3c, #221620);
}
.mood.m4 {
  background: linear-gradient(135deg, #243a4a, #14222b);
}
.mood.m5 {
  background: linear-gradient(135deg, #4a2a35, #24141a);
}
.mood.m6 {
  background: linear-gradient(135deg, #2a4038, #15221d);
}
.mood.m7 {
  background: linear-gradient(135deg, #353045, #1b1824);
}
.mood-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.35;
}
.mood-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(8, 10, 16, 0.85), rgba(8, 10, 16, 0.15));
}
.mood-info {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mood-name {
  font-size: 13.5px;
  font-weight: 600;
}
.mood-desc {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.62);
}
.mood-icon {
  position: absolute;
  right: 12px;
  top: 12px;
  opacity: 0.28;
}

.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 28px;
}
.podcast-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.podcast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px;
  border-radius: 10px;
  text-align: left;
  color: var(--text);
}
.podcast:hover {
  background: var(--hover);
}
.pc-meta {
  flex: 1;
  min-width: 0;
}
.pc-name {
  font-size: 12px;
  line-height: 1.35;
}
.pc-sub {
  font-size: 10.5px;
  color: var(--text-3);
  margin-top: 2px;
}
.pc-ext {
  color: var(--text-3);
  opacity: 0;
}
.podcast:hover .pc-ext {
  opacity: 1;
}
.memory-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px;
  border-radius: 18px;
  background:
    radial-gradient(120% 160% at 88% 20%, rgba(168, 85, 247, 0.28), transparent 60%),
    linear-gradient(120deg, #191326, #131722);
  border: 1px solid var(--line);
  color: #fff;
}
.mem-kicker {
  font-size: 10.5px;
  letter-spacing: 2px;
  color: #c4b5fd;
  text-transform: uppercase;
}
.mem-left h3 {
  margin-top: 7px;
  font-size: 20px;
  font-weight: 600;
}
.mem-left h3 b {
  color: var(--accent);
  font-size: 24px;
}
.mem-left p {
  margin-top: 5px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
}
.mem-singers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.mem-singers .chip {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  cursor: default;
}
.mem-right {
  color: rgba(255, 255, 255, 0.25);
}
.foot-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 34px;
  font-size: 11px;
  color: var(--text-3);
}
.skeleton-page {
  padding-top: 12px;
}
.sk-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-top: 22px;
}

@media (max-width: 1280px) {
  .grid-cards {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .mood-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .recent-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .toplist-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .two-col {
    grid-template-columns: 1fr;
  }
  .hero-content {
    max-width: 78%;
  }
}
</style>
