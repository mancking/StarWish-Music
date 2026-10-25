<script setup lang="ts">
import { computed, defineOptions, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import SongRows from '@/components/mobile/SongRows.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import type { Song } from '@shared/types'
import { platformLabel } from '@/utils/labels'
import { onPullRefresh, refreshDone } from '@/mobile/pull-refresh'

/**
 * 移动端发现页 —— 模板级独立实现（非桌面缩放）。
 *
 * 与桌面差异：分段式 tab（歌单/排行/新歌）吸顶、分类横滑胶囊、
 * 歌单 2 列大封面卡、榜单纵向卡列表（点整行即播），无悬浮筛选弹层。
 * 数据走同一组 bridge 通道，切换分类/音源一律立即给骨架反馈。
 */
defineOptions({ name: 'Discover' })

type Tab = 'playlists' | 'toplists' | 'new'
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const tab = ref<Tab>(((route.query.tab as string) || 'playlists') as Tab)
const cat = ref((route.query.cat as string) || '全部')
const plSource = ref('wy')
const order = ref<'hot' | 'new'>('hot')

const platforms = ['wy', 'qq', 'kg', 'kw', 'mg']

/* ---- 歌单 ---- */
const playlists = ref<any[]>([])
const plLoading = ref(false)
const plError = ref('')
let plReqSeq = 0
const plCache = new Map<string, { list: any[] }>()

/**
 * 多级分类
 *
 * 旧实现是 14 个写死的一级标签（CATS），既没有平台原生的「语种/专区/主题/心情」
 * 二级维度，也没有走 music:playlistTags —— QQ 等平台按标签 id 检索，
 * 直接传中文名会返回空列表，这就是「分类筛选无法使用」的根因之一。
 * 现在与桌面端共用同一套分组标签（后端 music:playlistTags 提供，缺失时用内置兜底），
 * 结构为：分组（一级）→ 标签（二级），两级同时可见。
 */
interface TagGroup {
  name: string
  tags: { n: string; id: string }[]
}
const DEFAULT_TAG_GROUPS: TagGroup[] = [
  { name: '热门', tags: ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', '乡村'] },
  { name: '语种', tags: ['全部', '华语', '欧美', '日语', '韩语', '粤语', '小语种'] },
  { name: '专区', tags: ['影视原声', 'ACG', '怀旧', '儿童', '校园', '游戏', 'KTV', 'DJ', '器乐'] },
  { name: '主题', tags: ['伤感', '治愈', '励志', '甜蜜', '兴奋', '安静', '思念', '翻唱', '现场'] },
  { name: '心情', tags: ['运动', '夜晚', '学习', '浪漫', '减压', '通勤', '派对', '咖啡', '驾车', '午后'] },
].map(g => ({ name: g.name, tags: g.tags.map(n => ({ n, id: n })) }))

const tagGroups = ref<TagGroup[]>(DEFAULT_TAG_GROUPS)
const groupIdx = ref(0)
const currentTags = computed(() => tagGroups.value[groupIdx.value]?.tags || [])
/** 传上游的分类 id：QQ 等平台要标签 id，网易云等名称即 id */
const catId = computed(() => {
  for (const g of tagGroups.value) for (const t of g.tags) if (t.n === cat.value) return t.id || t.n
  return cat.value
})
/** 切换中标记：点击即刻置真，保证有可见反馈 */
const plSwitching = ref(false)
/** 标签接口进行中：切平台时旧标签会残留，必须清掉并显示骨架 */
const tagsLoading = ref(false)
const PL_TTL = 60_000

async function loadTags(src: string): Promise<void> {
  tagsLoading.value = true
  try {
    const gs = await call<{ name: string; tags: { n: string; id?: string }[] }[]>('music:playlistTags', { source: src })
    if (plSource.value !== src) return
    if (gs?.length) {
      tagGroups.value = gs.map(g => ({ name: g.name, tags: g.tags.map(t => ({ n: t.n, id: t.id || t.n })) }))
      groupIdx.value = 0
    }
  } catch {
    /* 标签接口失败：保留内置分组，不阻断歌单浏览 */
  } finally {
    if (plSource.value === src) tagsLoading.value = false
  }
}

async function loadPlaylists(force = false): Promise<void> {
  const seq = ++plReqSeq
  const key = `${plSource.value}|${catId.value}|${order.value}`
  plSwitching.value = true
  const hit = plCache.get(key)
  if (hit && !force) {
    playlists.value = hit.list
    // 缓存命中也要有反馈：短暂显示切换态，然后后台静默刷新
    if (Date.now() - (hit as any).ts < PL_TTL) {
      plSwitching.value = false
      return
    }
  }
  plLoading.value = !playlists.value.length
  plError.value = ''
  try {
    const list = await call<any[]>('music:playlists', {
      cat: catId.value,
      order: order.value,
      page: 1,
      source: plSource.value,
    })
    if (seq !== plReqSeq) return
    if (list.length) plCache.set(key, { list, ts: Date.now() } as any)
    playlists.value = list
    if (!list.length) plError.value = '该分类暂无歌单，换一个试试'
  } catch (e: any) {
    if (seq !== plReqSeq) return
    if (!playlists.value.length) plError.value = e?.message || '歌单加载失败'
  } finally {
    if (seq === plReqSeq) {
      plLoading.value = false
      plSwitching.value = false
    }
  }
}

function setCat(c: string): void {
  // 错误态下允许点同一标签重试，不需要「来回切」才刷新
  if (cat.value === c && !plError.value) return
  cat.value = c
  plSwitching.value = true
  plError.value = ''
  router.replace({ path: '/discover', query: { ...route.query, tab: 'playlists', cat: c } })
  void loadPlaylists(true)
}

/** 切换一级分组：默认落到该组第一个标签，并立即请求 */
function setGroup(i: number): void {
  if (groupIdx.value === i) return
  groupIdx.value = i
  const first = tagGroups.value[i]?.tags?.[0]
  if (first) setCat(first.n)
}

function setSource(s: string): void {
  if (plSource.value === s) return
  plSource.value = s
  cat.value = '全部'
  groupIdx.value = 0
  playlists.value = []
  plSwitching.value = true
 // 立刻清空旧平台标签，避免切换窗口期点到旧标签查出空列表
  tagGroups.value = []
  void loadTags(s)
  void loadPlaylists(true)
}

function setOrder(o: 'hot' | 'new'): void {
  if (order.value === o) return
  order.value = o
  plSwitching.value = true
  void loadPlaylists(true)
}

/* ---- 榜单 ---- */
const tree = ref<any>(null)
const tlPlatform = ref('wy')
const groups = computed<any[]>(() => tree.value?.tree?.[tlPlatform.value]?.groups || [])
const tlItems = computed<any[]>(() => groups.value.flatMap((g: any) => (g.items || []).map((i: any) => ({ ...i, group: g.name }))))

async function loadTree(): Promise<void> {
  try {
    tree.value = await call<any>('music:toplists')
  } catch {
    tree.value = null
  }
}

/** 打开榜单详情页（不再直接播放）：详情页可看完整曲目并可整体播放，
 *  同时把「榜单无法打开」的报错可视化到详情页里 */
function openToplist(item: any): void {
  router.push(`/toplist/${tlPlatform.value}/${item.id}`)
}

/* ---- 新歌 ---- */
const newSongs = ref<Song[]>([])
const newLoading = ref(false)
async function loadNew(): Promise<void> {
  if (newLoading.value || newSongs.value.length) return
  newLoading.value = true
  try {
    newSongs.value = await call<Song[]>('music:new')
  } catch {
    newSongs.value = []
  } finally {
    newLoading.value = false
  }
}

function setTab(t: Tab): void {
  if (tab.value === t) return
  tab.value = t
  router.replace({ path: '/discover', query: { ...route.query, tab: t } })
}

watch(tab, t => {
  if (t === 'new') void loadNew()
  if (t === 'toplists' && !tree.value) void loadTree()
  if (t === 'playlists' && !playlists.value.length) void loadPlaylists()
})

/**
 * 外部入口（首页「全部新歌」「全部榜单」「按心情听」）会带 query 进来，
 * 而本页被 KeepAlive 缓存 —— 只靠 watch(tab) 不会响应，
 * 必须同步 route.query 并按需补数据，否则表现为「点进去是空白页」。
 */
watch(
  () => route.query.tab,
  v => {
    const t = (v as string) as Tab
    if (!t || t === tab.value) return
    tab.value = t
  }
)
watch(
  () => route.query.cat,
  v => {
    const c = (v as string) || '全部'
    if (c !== cat.value) {
      cat.value = c
      void loadPlaylists()
    }
  }
)

/* 下拉刷新：重拉当前 tab 数据，保留路由、分类与滚动位置 */
const offPull = onPullRefresh(async () => {
  if (tab.value === 'playlists') await loadPlaylists(true)
  else if (tab.value === 'toplists') await loadTree()
  else await loadNew()
  refreshDone()
})
onBeforeUnmount(() => offPull())

onMounted(() => {
  void loadTags(plSource.value)
  void loadPlaylists()
  void loadTree()
  if (tab.value === 'new') void loadNew()
})
</script>

<template>
  <div class="page m-disc">
    <!-- 分段 tab：吸顶 -->
    <nav class="d-seg">
      <button class="d-seg-item" :class="{ on: tab === 'playlists' }" @click="setTab('playlists')">歌单</button>
      <button class="d-seg-item" :class="{ on: tab === 'toplists' }" @click="setTab('toplists')">排行榜</button>
      <button class="d-seg-item" :class="{ on: tab === 'new' }" @click="setTab('new')">新歌</button>
    </nav>

    <!-- ============ 歌单 ============ -->
    <template v-if="tab === 'playlists'">
      <!-- 音源 + 排序：横滑胶囊 -->
      <div class="d-row">
        <div class="d-chips">
          <button
            v-for="p in platforms"
            :key="p"
            class="d-chip"
            :class="{ on: plSource === p }"
            @click="setSource(p)"
          >{{ platformLabel(p) }}</button>
        </div>
        <div class="d-order">
          <button :class="{ on: order === 'hot' }" @click="setOrder('hot')">最热</button>
          <i />
          <button :class="{ on: order === 'new' }" @click="setOrder('new')">最新</button>
        </div>
      </div>
 <!-- 多级分类：一级分组横滑 + 二级标签横滑 -->
      <div class="d-cats d-groups">
        <button
          v-for="(g, i) in tagGroups"
          :key="g.name"
          class="d-cat d-gcat"
          :class="{ on: groupIdx === i }"
          @click="setGroup(i)"
        >{{ g.name }}</button>
      </div>
      <div v-if="tagsLoading" class="d-cats">
        <span v-for="i in 6" :key="i" class="sk d-cat-sk" />
      </div>
      <div v-else class="d-cats">
        <button
          v-for="t in currentTags"
          :key="t.id"
          class="d-cat"
          :class="{ on: cat === t.n }"
          @click="setCat(t.n)"
        >{{ t.n }}</button>
      </div>

      <p v-if="!tagsLoading && !tagGroups.length" class="d-cat-none">该平台未提供歌单分类，已按「全部」展示</p>

      <!-- 切换中：细进度条，点击即出现 -->
      <div v-if="plSwitching" class="d-progress" />

      <!-- 骨架 / 空 / 2 列大卡 -->
      <div v-if="plLoading && !playlists.length" class="d-grid">
        <div v-for="i in 6" :key="i" class="sk" style="height: 190px; border-radius: 14px" />
      </div>
      <div v-else-if="plError && !playlists.length" class="empty" style="padding: 46px 16px">
        <div class="empty-title">{{ plError }}</div>
      </div>
      <div v-else class="d-grid" :class="{ stale: plSwitching }">
        <button v-for="pl in playlists" :key="pl.id" class="d-pl" @click="router.push({ path: `/playlist/${pl.id}`, query: { src: pl.source || plSource, name: pl.name } })">
          <Cover :src="pl.pic || ''" :size="170" radius="12" class="d-pl-cover" />
          <div class="d-pl-name">{{ pl.name }}</div>
          <div class="d-pl-sub">{{ pl.author || pl.source || '' }}</div>
        </button>
      </div>
    </template>

    <!-- ============ 排行榜 ============ -->
    <template v-else-if="tab === 'toplists'">
      <div class="d-row">
        <div class="d-chips">
          <button
            v-for="p in platforms"
            :key="p"
            class="d-chip"
            :class="{ on: tlPlatform === p }"
            @click="tlPlatform = p"
          >{{ platformLabel(p) }}</button>
        </div>
      </div>
      <div v-if="!groups.length" class="empty" style="padding: 46px 16px">
        <div class="empty-title">榜单加载中…</div>
      </div>
      <div class="d-tl-list">
        <button v-for="(t, i) in tlItems" :key="tlPlatform + t.id" class="d-tl" @click="openToplist(t)">
          <span class="d-tl-rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
          <span class="d-tl-meta">
            <span class="d-tl-name">{{ t.n }}</span>
            <span class="d-tl-sub">{{ t.group }}<template v-if="t.freq"> · {{ t.freq }}</template></span>
          </span>
          <Icon name="chevron-right" :size="16" class="d-tl-play" />
        </button>
      </div>
    </template>

    <!-- ============ 新歌 ============ -->
    <template v-else>
      <div class="d-sec-head">
        <span class="d-sec-title"><Icon name="music" :size="16" />新歌速递</span>
        <button class="d-sec-all" @click="router.push('/new')">
          全部<Icon name="chevron-right" :size="13" />
        </button>
      </div>
      <div v-if="newLoading" class="d-list-sk">
        <div v-for="i in 6" :key="i" class="sk" style="height: 58px; border-radius: 12px" />
      </div>
      <SongRows v-else :songs="newSongs" show-index empty-text="暂无新歌" empty-desc="稍后再来看看" />
    </template>
  </div>
</template>

<style scoped>
/* 分段 tab */
.d-seg {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 6px;
  padding: 8px 0 10px;
  background: var(--bg);
}
.d-seg-item {
  flex: 1;
  height: 40px;
  border-radius: 12px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-3);
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
}
.d-seg-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

/* 行内布局 */
.d-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.d-chips {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.d-chips::-webkit-scrollbar {
  display: none;
}
.d-chip {
  flex: none;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12.5px;
  -webkit-tap-highlight-color: transparent;
}
.d-chip.on {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.d-order {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 3px 6px;
}
.d-order button {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 13px;
  background: none;
  color: var(--text-3);
  font-size: 12.5px;
}
.d-order button.on {
  background: var(--accent);
  color: #fff;
}
.d-order i {
  width: 1px;
  height: 14px;
  background: var(--line);
}
.d-cats {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  margin: 0 -16px 14px;
  padding: 2px 16px;
  scrollbar-width: none;
}
.d-cats::-webkit-scrollbar {
  display: none;
}
.d-cat {
  flex: none;
  height: 34px;
  padding: 0 15px;
  border-radius: 17px;
  border: 0;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 13px;
  -webkit-tap-highlight-color: transparent;
}
.d-cat.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}
/* 一级分组：比二级标签更轻，避免两组胶囊抢视觉 */
.d-groups .d-gcat {
  background: transparent;
  border: 1px solid var(--line);
  height: 30px;
  font-size: 12.5px;
}
.d-groups .d-gcat.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.d-cat-none {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-3);
}
.d-cat-sk {
  flex: none;
  width: 62px;
  height: 34px;
  border-radius: 17px;
}
.d-cat-sk {
  flex: none;
  width: 62px;
  height: 34px;
  border-radius: 17px;
}
.d-progress {
  position: relative;
  height: 2px;
  margin: -6px 0 10px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--panel-2);
}
.d-progress::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: d-slide 0.9s ease-in-out infinite;
}
@keyframes d-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
.d-grid.stale {
  opacity: 0.5;
  pointer-events: none;
  transition: opacity 0.15s;
}

/* 歌单 2 列大卡 */
.d-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
}
.d-pl {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.d-pl:active .d-pl-cover {
  transform: scale(0.97);
  transition: transform 0.12s;
}
.d-pl-name {
  margin-top: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-pl-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 榜单纵向卡 */
.d-tl-list,
.m-song-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.d-tl,
.d-new {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 6px 10px;
  border: 0;
  border-radius: 13px;
  background: var(--bg-2);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.d-tl:active,
.d-new:active {
  filter: brightness(1.15);
}
.d-tl-rank {
  width: 24px;
  text-align: center;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-3);
}
.d-tl-rank.top {
  color: var(--accent);
}
.d-tl-meta,
.d-new-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.d-tl-name,
.d-new-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-tl-sub,
.d-new-sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-tl-play {
  flex: none;
  color: var(--text-3);
}
.d-list-sk {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 分区头（标题 + 全部入口） */
.d-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 2px 0 10px;
}
.d-sec-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.d-sec-all {
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
  -webkit-tap-highlight-color: transparent;
}
</style>
