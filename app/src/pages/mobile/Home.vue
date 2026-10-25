<script setup lang="ts">
import { computed, defineOptions, onBeforeUnmount, onMounted, ref } from 'vue'
import NebulaBg from '@/components/NebulaBg.vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { call } from '@/api'
import brandIcon from '@/assets/brand-icon.png'
import { usePlayerStore } from '@/stores/player'
import { onPullRefresh, refreshDone } from '@/mobile/pull-refresh'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@shared/types'

/**
 * 移动端推荐页 —— 模板级重写（v1.0.0）。
 *
 * 重写要点（对齐市面移动音乐 App 的「推荐」页信息架构）：
 *  ① 顶部只有问候 + 搜索，不再堆快捷入口（与底栏重复）
 *  ② 首个内容块是「每日推荐」——每日推荐是 App 的核心资产，必须在首屏
 *  ③ 每个区块内容互斥：每日推荐 / 新歌速递 / 热门榜单 不再展示同一批曲目
 *     （数据层 recommend.ts 已做跨区块去重）
 *  ④ 榜单区展示「榜单速览」（封面 + 前 3 首 + 完整入口），点开进独立榜单页
 *  ⑤ 新歌区只放 6 首 + 「全部」入口，点开进独立新歌页
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

/* ---------------- 私人电台 ---------------- */
const radio = ref<{ songs: Song[]; seeds: string[] }>({ songs: [], seeds: [] })
const radioLoading = ref(false)

async function loadRadio(force = false): Promise<void> {
  if (radioLoading.value) return
  radioLoading.value = true
  try {
    const r = await call<{ songs: Song[]; seeds: string[] }>('radio:build', { force, size: 60 })
    radio.value = { songs: r.songs || [], seeds: r.seeds || [] }
  } catch {
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

/** 首页搜索：输入即跳搜索页（与底栏搜索同一去向） */
const searchText = ref('')
function submitSearch(): void {
  const k = searchText.value.trim()
  if (!k) return
  router.push({ path: '/search', query: { q: k } })
  searchText.value = ''
}

async function load(force = false): Promise<void> {
  if (force) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    const [f, m] = await Promise.all([call('home:feed', { force }), call('music:memory').catch(() => null)])
    feed.value = f
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

function openToplist(card: any): void {
  router.push(`/toplist/${card.platform}/${card.id}`)
}

/* 下拉刷新：重拉本页数据，保留路由与滚动位置 */
const offPull = onPullRefresh(async () => {
  await load(true)
  refreshDone()
})
onBeforeUnmount(() => offPull())

onMounted(() => {
  void load()
  void loadRadio()
})
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
 <!-- 顶部卡片：深色星云 + 品牌 / 问候 / 搜索（与桌面端 hero 同构，
           星云只存在于这张卡片内，卡片外的一切跟随主题，不再整页铺背景 -->
      <header class="m-head m-hero">
        <NebulaBg compact />
        <div class="m-hero-inner">
        <div class="m-brand-top" aria-label="星河音乐">
          <img class="m-brand-top-logo" :src="brandIcon" alt="星河音乐" draggable="false" />
          <span class="m-brand-top-name">星河音乐</span>
        </div>
        <div class="m-kicker">{{ dateText }}</div>
        <h1 class="m-greet">{{ greeting }}，欢迎回来</h1>
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
        </div>
      </header>

      <!-- ① 每日推荐：首屏核心资产 -->
      <section v-if="daily.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="sparkles" :size="16" />每日推荐
          <button class="m-sec-act" @click="playDaily"><Icon name="play" :size="13" />播放</button>
        </div>
        <div class="m-car">
          <button v-for="(s, i) in daily.slice(0, 10)" :key="s.id" class="m-card" @click="player.playSongs(daily, i)">
            <Cover :src="s.pic || ''" :size="132" radius="12" class="m-card-cover" />
            <div class="m-card-name">{{ s.name }}</div>
            <div class="m-card-sub">{{ s.singer }}</div>
          </button>
        </div>
      </section>

      <!-- ② 继续收听 -->
      <section v-if="continueList.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="clock" :size="16" />继续收听
          <button class="m-sec-act" @click="router.push('/history')"><Icon name="chevron-right" :size="13" />全部</button>
        </div>
        <div class="m-car">
          <button v-for="(s, i) in continueList" :key="s.id" class="m-card" @click="player.playSongs(continueList, i)">
            <Cover :src="s.pic || ''" :size="132" radius="12" class="m-card-cover" />
            <div class="m-card-name">{{ s.name }}</div>
            <div class="m-card-sub">{{ s.singer }}</div>
          </button>
        </div>
      </section>

      <!-- ③ 推荐歌单 -->
      <section v-if="playlists.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="list" :size="16" />推荐歌单
          <button class="m-sec-act" @click="router.push({ path: '/discover', query: { tab: 'playlists' } })">
            <Icon name="chevron-right" :size="13" />全部
          </button>
        </div>
        <div class="m-car">
          <button v-for="pl in playlists" :key="pl.id" class="m-card" @click="openPlaylist(pl)">
            <Cover :src="pl.pic || ''" :size="132" radius="12" class="m-card-cover" />
            <div class="m-card-name">{{ pl.name }}</div>
            <div class="m-card-sub">{{ pl.playCountText || pl.author || '' }}</div>
          </button>
        </div>
      </section>

      <!-- ④ 新歌速递：只 6 首 + 全部入口 -->
      <section v-if="newSongs.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="music" :size="16" />新歌速递
          <button class="m-sec-act" @click="router.push('/new')"><Icon name="chevron-right" :size="13" />全部</button>
        </div>
        <div class="m-list">
          <button
            v-for="(s, i) in newSongs.slice(0, 6)"
            :key="s.id"
            class="m-song"
            @click="player.playSongs(newSongs, i)"
          >
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

      <!-- ⑤ 热门榜单速览：卡片含榜单前 3 首，点开进独立榜单页 -->
      <section v-if="toplists.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="gauge" :size="16" />热门榜单
          <button class="m-sec-act" @click="router.push({ path: '/discover', query: { tab: 'toplists' } })">
            <Icon name="chevron-right" :size="13" />全部
          </button>
        </div>
        <div class="m-tl-list">
          <button v-for="card in toplists" :key="card.id" class="m-tl-card" @click="openToplist(card)">
            <Cover :src="card.pic || ''" :size="52" radius="10" class="m-tl-cover" />
            <span class="m-tl-info">
              <span class="m-tl-name">{{ card.name }}</span>
              <span class="m-tl-prev">
                <span v-for="(s, i) in card.songs.slice(0, 3)" :key="s.id" class="m-tl-line">
                  <i>{{ i + 1 }}</i>{{ s.name }} — {{ s.singer }}
                </span>
              </span>
            </span>
            <Icon name="chevron-right" :size="16" class="m-tl-arrow" />
          </button>
        </div>
      </section>

      <!-- ⑥ 私人电台 -->
      <section v-if="radio.songs.length" class="m-sec">
        <div class="m-sec-title">
          <Icon name="radio" :size="16" />私人电台
          <button class="m-sec-act" @click="shuffleRadio">
            <Icon name="refresh" :size="13" />{{ radioLoading ? '生成中…' : '换一批' }}
          </button>
          <button class="m-sec-act" @click="playRadio"><Icon name="play" :size="13" />播放</button>
        </div>
        <div class="m-sec-sub">
          {{ radio.seeds.length ? `根据 ${radio.seeds.join('、')} 的口味持续推荐` : '按你的收听口味持续推荐' }}
        </div>
        <div class="m-car">
          <button v-for="(s, i) in radio.songs.slice(0, 10)" :key="s.id" class="m-card sm" @click="player.playSongs(radio.songs, i)">
            <Cover :src="s.pic || ''" :size="96" radius="10" class="m-card-cover" />
            <div class="m-card-name">{{ s.name }}</div>
            <div class="m-card-sub">{{ s.singer }}</div>
          </button>
        </div>
      </section>

      <!-- ⑦ 音乐回忆 -->
      <section v-if="memorySingers.length" class="m-sec">
        <div class="m-sec-title"><Icon name="star" :size="16" />音乐回忆</div>
        <div class="m-chips">
          <button v-for="n in memorySingers" :key="n" class="m-chip" @click="router.push({ path: '/search', query: { q: n } })">
            {{ n }}
          </button>
        </div>
      </section>

      <!-- ⑧ 按心情听 -->
      <section v-if="moods.length" class="m-sec">
        <div class="m-sec-title"><Icon name="compass" :size="16" />按心情听</div>
        <div class="m-chips">
          <button
            v-for="m in moods.slice(0, 8)"
            :key="m.cat"
            class="m-chip"
            @click="router.push({ path: '/discover', query: { tab: 'playlists', cat: m.cat } })"
          >
            {{ m.cat }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.m-home {
  padding-bottom: 36px;
}
/* 顶部卡片：深色星云固定视觉，卡片内语义色锁定为浅色，
   卡片外（各内容区）继续跟随主题 —— 修掉「浅色主题下首页文字全隐形」的根因 */
.m-head.m-hero {
  position: relative;
  overflow: hidden;
  margin: 4px 0 20px;
  padding: 16px 14px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 40px -24px rgba(20, 12, 50, 0.9);
  --text: #eef1f8;
  --text-2: rgba(255, 255, 255, 0.72);
  --text-3: rgba(255, 255, 255, 0.52);
  --bg-2: rgba(255, 255, 255, 0.09);
  --bg-3: rgba(255, 255, 255, 0.13);
  --line: rgba(255, 255, 255, 0.16);
  --line-2: rgba(255, 255, 255, 0.24);
  --panel: rgba(255, 255, 255, 0.07);
  --hover: rgba(255, 255, 255, 0.1);
}
.m-hero-inner {
  position: relative;
  z-index: 1;
}
/* 顶部品牌行（用户指令：logo 置顶） */
.m-brand-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.m-brand-top-logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.6);
}
.m-brand-top-name {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text);
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
  text-shadow: 0 2px 14px rgba(9, 7, 26, 0.55);
  white-space: nowrap;
  overflow: visible;
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
.m-sec-sub {
  font-size: 12px;
  color: var(--text-3);
  margin: -6px 0 10px 11px;
}
.m-sec-act {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  -webkit-tap-highlight-color: transparent;
}
.m-sec-act:active {
  filter: brightness(1.2);
}
/* 多个操作按钮时：第一个靠右，其余紧随 */
.m-sec-act + .m-sec-act {
  margin-left: 6px;
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
.m-song-cover {
  flex: none;
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

/* 榜单速览卡 */
.m-tl-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-tl-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--bg-2);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.m-tl-card:active {
  filter: brightness(1.15);
}
.m-tl-cover {
  flex: none;
}
.m-tl-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.m-tl-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-tl-prev {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-tl-line {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-tl-line i {
  display: inline-block;
  width: 16px;
  font-style: normal;
  color: var(--accent);
  font-weight: 700;
}
.m-tl-arrow {
  flex: none;
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
/*星云背景层在内容之下 */
/* 卡片内的星云铺满卡片，不拦截点击 */
.m-hero :deep(.nebula) {
  position: absolute;
  inset: 0;
  z-index: 0;
}
