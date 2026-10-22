<script lang="ts">
// 与桌面 Home.vue 共用模块级缓存（feedCache 跨实例存活）
let feedCache: any = null
</script>
<script setup lang="ts">
import { computed, defineOptions, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'

/**
 * 移动端首页 —— 全新模板级实现（非桌面缩小版）。
 *
 * 与桌面首页的实质差异（设计依据 docs/mobile-ui-research-v2.3.1.md）：
 *  - 无巨型 hero 横幅：改为单手可达的问候头 + 横滑快捷入口（国内音乐 App 惯例）
 *  - 所有内容区一律「横向 snap 卡片流」，杜绝桌面网格在窄屏的挤压与截断
 *  - 文案单行 + 完整省略号，绝不出现「显示一半」
 *  - 每个分区独立加载容错，一处失败不拖垮整页
 */
defineOptions({ name: 'Home' })

const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

const loading = ref(true)
const error = ref('')
const feed = ref<any>(null)
const refreshing = ref(false)
const memory = ref<any>(null)

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
const newSongs = computed<Song[]>(() => feed.value?.newSongs || [])
const onRepeat = computed<Song[]>(() => feed.value?.onRepeat || [])
const moods = computed<any[]>(() => feed.value?.moods || [])
const memorySingers = computed<string[]>(() => memory.value?.topSingers?.slice(0, 6)?.map((s: any) => s.name || s) || [])

const quickActions = computed(() => [
  { icon: 'sparkles', label: '每日推荐', run: playDaily },
  { icon: 'trophy', label: '排行榜', run: () => router.push('/discover') },
])

/** 首页搜索：输入即跳搜索页（与底栏搜索同一去向） */
const searchText = ref('')
function submitSearch(): void {
  const k = searchText.value.trim()
  if (!k) return
  router.push({ path: '/search', query: { q: k } })
  searchText.value = ''
}

async function load(force = false): Promise<void> {
  if (!force && feedCache) {
    feed.value = feedCache
    loading.value = false
    void call('home:feed', { force: false })
      .then((f: any) => {
        feedCache = f
        feed.value = f
      })
      .catch(() => {})
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

onMounted(() => void load())
defineExpose({ refresh: () => load(true) })
</script>

<template>
  <div class="page m-home">
    <!-- 骨架 -->
    <div v-if="loading" class="skeleton-page">
      <div class="sk" style="height: 72px; border-radius: 16px" />
      <div class="sk-row" style="margin-top: 16px">
        <div v-for="i in 3" :key="i" class="sk" style="height: 160px; width: 132px; border-radius: 14px" />
      </div>
      <div class="sk" style="height: 22px; width: 120px; margin: 26px 0 14px" />
      <div v-for="i in 4" :key="i" class="sk" style="height: 56px; border-radius: 12px; margin-bottom: 8px" />
    </div>

    <div v-else-if="error" class="empty" style="padding: 70px 18px">
      <Icon name="wifi" :size="34" :stroke="1.3" />
      <div class="empty-title">内容加载失败</div>
      <div class="empty-desc">{{ error }}</div>
      <button class="btn primary" style="margin-top: 14px" @click="load(true)">重试</button>
    </div>

    <template v-else>
      <!-- 问候头 + 搜索框：三行短文案，永不截断 -->
      <header class="m-head">
        <div class="m-kicker">{{ dateText }}</div>
        <h1 class="m-greet">{{ greeting }}，欢迎回来</h1>
        <p class="m-sub">从星河里捞一首歌，陪你度过此刻</p>
        <div class="m-search">
          <Icon name="search" :size="17" class="m-search-icon" />
          <input
            v-model="searchText"
            type="search"
            placeholder="搜索歌曲、歌手、歌单"
            enterkeyhint="search"
            @keydown.enter="submitSearch"
          />
          <button class="m-search-go" @click="submitSearch">搜索</button>
        </div>
      </header>

      <!-- 快捷入口：仅保留有实际动作的项（每日推荐直达播放 / 排行榜直达榜单），
           其余去重——底栏已有「发现/视频/我的」，我喜欢的在「我的」页 -->
      <nav v-if="quickActions.length" class="m-quick">
        <button v-for="q in quickActions" :key="q.label" class="m-quick-item" @click="q.run()">
          <Icon :name="q.icon" :size="16" />
          <span>{{ q.label }}</span>
        </button>
      </nav>

      <!-- 继续收听：横滑大卡 -->
      <section v-if="continueList.length" class="m-sec">
        <div class="m-sec-title"><Icon name="clock" :size="16" />继续收听</div>
        <div class="m-car">
          <button v-for="s in continueList" :key="s.id" class="m-card" @click="player.playSongs(continueList)">
            <Cover :src="s.pic || ''" :size="132" radius="12" class="m-card-cover" />
            <div class="m-card-name">{{ s.name }}</div>
            <div class="m-card-sub">{{ s.singer }}</div>
          </button>
        </div>
      </section>

      <!-- 推荐歌单：横滑卡 -->
      <section v-if="playlists.length" class="m-sec">
        <div class="m-sec-title"><Icon name="list" :size="16" />推荐歌单</div>
        <div class="m-car">
          <button v-for="pl in playlists" :key="pl.id" class="m-card" @click="openPlaylist(pl)">
            <Cover :src="pl.pic || ''" :size="132" radius="12" class="m-card-cover" />
            <div class="m-card-name">{{ pl.name }}</div>
            <div class="m-card-sub">{{ pl.playCountText || pl.author || '' }}</div>
          </button>
        </div>
      </section>

      <!-- 新歌速递：紧凑编号列表 -->
      <section v-if="newSongs.length" class="m-sec">
        <div class="m-sec-title"><Icon name="music" :size="16" />新歌速递</div>
        <div class="m-list">
          <button v-for="(s, i) in newSongs.slice(0, 6)" :key="s.id" class="m-song" @click="player.playSongs(newSongs.slice(0, 6), i)">
            <span class="m-song-idx" :class="{ hot: i < 3 }">{{ i + 1 }}</span>
            <Cover :src="s.pic || ''" :size="44" radius="9" class="m-song-cover" />
            <span class="m-song-meta">
              <span class="m-song-name">{{ s.name }}</span>
              <span class="m-song-sub">{{ s.singer }}</span>
            </span>
            <Icon name="play" :size="16" class="m-song-play" />
          </button>
        </div>
      </section>

      <!-- 榜单快捷：横滑胶囊卡 -->
      <section v-if="toplists.length" class="m-sec">
        <div class="m-sec-title"><Icon name="trophy" :size="16" />热门榜单</div>
        <div class="m-car">
          <button v-for="(t, i) in toplists.slice(0, 10)" :key="t.id" class="m-tl" @click="playToplist(t)">
            <span class="m-tl-rank">{{ i + 1 }}</span>
            <span class="m-tl-name">{{ t.name }}</span>
            <Icon name="play" :size="14" class="m-tl-play" />
          </button>
        </div>
      </section>

      <!-- 单曲循环 / 心情 -->
      <section v-if="onRepeat.length" class="m-sec">
        <div class="m-sec-title"><Icon name="repeat" :size="16" />你在循环</div>
        <div class="m-car">
          <button v-for="s in onRepeat" :key="s.id" class="m-card sm" @click="player.playSongs(onRepeat)">
            <Cover :src="s.pic || ''" :size="96" radius="10" class="m-card-cover" />
            <div class="m-card-name">{{ s.name }}</div>
            <div class="m-card-sub">{{ s.singer }}</div>
          </button>
        </div>
      </section>

      <!-- 音乐回忆 -->
      <section v-if="memorySingers.length" class="m-sec">
        <div class="m-sec-title"><Icon name="sparkles" :size="16" />音乐回忆</div>
        <div class="m-chips">
          <button v-for="n in memorySingers" :key="n" class="m-chip" @click="router.push({ path: '/search', query: { keyword: n } })">
            {{ n }}
          </button>
        </div>
      </section>

      <!-- 心情歌单入口 -->
      <section v-if="moods.length" class="m-sec">
        <div class="m-sec-title"><Icon name="compass" :size="16" />按心情听</div>
        <div class="m-chips">
          <button v-for="m in moods.slice(0, 8)" :key="m.cat" class="m-chip" @click="router.push({ path: '/discover', query: { tab: 'playlists', cat: m.cat } })">
            {{ m.cat }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.m-home {
  padding-bottom: 28px;
}
/* 问候头：完整三行，绝不截断 */
.m-head {
  padding: 10px 2px 4px;
}
.m-kicker {
  font-size: 12px;
  color: var(--text-3);
  letter-spacing: 0.4px;
}
.m-greet {
  margin: 4px 0 0;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: 0.3px;
  color: var(--text);
  white-space: nowrap;
  overflow: visible;
}
.m-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
}

/* 搜索框 */
.m-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  margin-top: 12px;
  padding: 0 6px 0 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg-2);
}
.m-search-icon {
  color: var(--text-3);
}
.m-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.m-search-go {
  flex: none;
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}

/* 快捷入口：横滑胶囊 */
.m-quick {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 14px -16px 4px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.m-quick::-webkit-scrollbar {
  display: none;
}
.m-quick-item {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  padding: 0 16px;
  border-radius: 21px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 13.5px;
  -webkit-tap-highlight-color: transparent;
}
.m-quick-item:active {
  filter: brightness(1.2);
}

/* 分区 */
.m-sec {
  margin-top: 26px;
}
.m-sec-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 12px;
}
.m-sec-title::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ff4d6d, #a855f7);
}

/* 横滑卡片流 */
.m-car {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  margin: 0 -16px;
  padding: 2px 16px 6px;
  scrollbar-width: none;
}
.m-car::-webkit-scrollbar {
  display: none;
}
.m-card {
  flex: none;
  width: 132px;
  scroll-snap-align: start;
  border: 0;
  background: none;
  text-align: left;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.m-card.sm {
  width: 96px;
}
.m-card.sm .m-card-cover {
  width: 96px !important;
  height: 96px !important;
}
.m-card-cover {
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
}
.m-card:active .m-card-cover {
  transform: scale(0.97);
  transition: transform 0.12s;
}
.m-card-name {
  margin-top: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-card-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 新歌速递列表 */
.m-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.m-song {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 4px 8px;
  border: 0;
  border-radius: 12px;
  background: none;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.m-song:active {
  background: var(--bg-2);
}
.m-song-idx {
  width: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  font-weight: 600;
}
.m-song-idx.hot {
  color: var(--accent);
}
.m-song-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-song-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-song-sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-song-play {
  flex: none;
  color: var(--text-3);
}

/* 榜单胶囊 */
.m-tl {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 46px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  scroll-snap-align: start;
  -webkit-tap-highlight-color: transparent;
}
.m-tl:active {
  filter: brightness(1.2);
}
.m-tl-rank {
  font-size: 13px;
  font-weight: 800;
  color: var(--accent);
}
.m-tl-name {
  font-size: 13.5px;
  color: var(--text);
  white-space: nowrap;
}
.m-tl-play {
  color: var(--text-3);
}

/* 心情/回忆 chips */
.m-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.m-chip {
  height: 40px;
  padding: 0 16px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 13px;
  -webkit-tap-highlight-color: transparent;
}
.m-chip:active {
  filter: brightness(1.2);
}
</style>
