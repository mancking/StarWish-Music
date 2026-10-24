<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongList from '@/components/SongList.vue'
import PlaylistCard from '@/components/PlaylistCard.vue'
import PlatformSelect, { type PlatformOption } from '@/components/PlatformSelect.vue'
import { call } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { PlaylistMeta, PlaylistTagGroup, Song, ToplistTree } from '@shared/types'
import { platformLabel } from '@/utils/labels'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const ui = useUiStore()

type Tab = 'playlists' | 'toplists' | 'new'
const tab = ref<Tab>(((route.query.tab as string) || 'playlists') as Tab)
const cat = ref((route.query.cat as string) || '全部')
const order = ref<'hot' | 'new'>('hot')

const playlists = ref<PlaylistMeta[]>([])
const plLoading = ref(false)
/** 当前页；上游接口无总数，故只给「首页/上一页/下一页」，页数由访问过的最大页推导 */
const plPage = ref(1)
const plFurthest = ref(1)
/** 最大已访问页是否还有下一页（返回满 30 条即认为有） */
const plHasNext = ref(true)
const plCanPrev = computed(() => plPage.value > 1)
const plCanNext = computed(() => plPage.value < plFurthest.value || plHasNext.value)

const tree = ref<ToplistTree | null>(null)
const treeLoading = ref(true)
const platform = ref('wy')
const currentItem = ref<{ name: string; id: string } | null>(null)
/** 当前榜单的更新频率（如「刚刚更新」），从树里反查 */
const currentFreq = computed(() => {
  const ci = currentItem.value
  if (!ci) return ''
  for (const g of groups.value) {
    const it = g.items.find(i => i.id === ci.id && i.n === ci.name)
    if (it?.freq) return it.freq
  }
  return ''
})
const toplistSongs = ref<Song[]>([])
const tlLoading = ref(false)
const tlError = ref('')

/** 客户端分页：榜单通常为 100 首，按页切分 */
const tlPageSize = 25
const tlPage = ref(1)
const tlPaged = computed(() => {
  const s = (tlPage.value - 1) * tlPageSize
  return toplistSongs.value.slice(s, s + tlPageSize)
})
const tlTotalPages = computed(() => Math.max(1, Math.ceil(toplistSongs.value.length / tlPageSize)))

const newSongs = ref<Song[]>([])
const newLoading = ref(true)

/** 歌单标签：按分组组织，与参考样式一致。切换音源后由 music:playlistTags 重新填充 */
const TAG_GROUPS = ref<PlaylistTagGroup[]>([])
const DEFAULT_PL_TAGS = [
  { name: '热门标签', tags: ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', '乡村'] },
  { name: '语种', tags: ['全部', '华语', '欧美', '日语', '韩语', '粤语', '小语种'] },
  { name: '专区', tags: ['影视原声', 'ACG', '怀旧', '儿童', '校园', '游戏', 'KTV', 'DJ', '器乐', '新世纪'] },
  { name: '主题', tags: ['伤感', '治愈', '励志', '甜蜜', '兴奋', '安静', '思念', '怀旧金曲', '翻唱', '现场'] },
  { name: '心情', tags: ['运动', '夜晚', '学习', '浪漫', '减压', '通勤', '派对', '咖啡', '驾车', '午后'] },
]
/** 网易云无标签接口，用内置分组（标签即 name 本身） */
TAG_GROUPS.value = DEFAULT_PL_TAGS.map(g => ({
  name: g.name,
  tags: g.tags.map(t => ({ n: t, id: t })),
}))

/** Bug 25：内嵌 chips 当前组（默认第一组） */
const chipsGroup = ref(0)
function switchChipsGroup(i: number): void {
  chipsGroup.value = i
  // 切组重置「全部」（规格 4.9）
  const g = TAG_GROUPS.value[i]
  if (g?.tags?.length) selectCat(g.tags[0]!.n)
}

/** 落雪式折叠标签弹层（保留变量兼容旧引用；chips 已内嵌） */
const tagOpen = ref(false)
const tagPopupWidth = ref(645)
/** 该音源是否有标签体系（酷我/酷狗/咪咕无分类标签，隐藏入口） */
const tagSupported = ref(true)

/**
 * 传给上游的分类参数。
 * QQ（小秋）接口要的是标签 id（流行=3152），直接传名称会返回空列表；
 * 网易云等以名称为 id 的音源两者一致，故取「当前分类名在标签表里对应的 id」。
 */
const catId = computed(() => {
  for (const g of TAG_GROUPS.value) {
    for (const t of g.tags) {
      if (t.n === cat.value) return t.id || t.n
    }
  }
  return cat.value
})

function toggleTags(): void {
  tagOpen.value = !tagOpen.value
}

function closeTags(): void {
  tagOpen.value = false
}

function syncTagPopupWidth(): void {
  const host = document.querySelector('.content') as HTMLElement | null
  tagPopupWidth.value = (host?.clientWidth || window.innerWidth) * 0.96
}

function onDocClick(e: MouseEvent): void {
  if (!tagOpen.value) return
  const el = e.target as HTMLElement | null
  if (el?.closest('.tag-select')) return
  closeTags()
}

function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeTags()
}

const platforms = computed<PlatformOption[]>(() => {
  if (!tree.value) return []
  return Object.keys(tree.value.tree).map(k => ({ key: k, name: platformLabel(k) }))
})

/** 歌单页的音源下拉：与排行榜同一套别名（小芸/小秋/小枸/小蜗/小蜜） */
const PL_SOURCES: PlatformOption[] = [
  { key: 'wy', name: platformLabel('wy') },
  { key: 'qq', name: platformLabel('qq') },
  { key: 'kg', name: platformLabel('kg') },
  { key: 'kw', name: platformLabel('kw') },
  { key: 'mg', name: platformLabel('mg') },
]
const plSource = ref('wy')

/** 切换音源：重置标签与分页。标签与歌单并行拉取——原先先 await 标签接口再拉歌单，
 *  切换音源期间界面无任何反馈（这就是「切换有延迟」的主因），现两者同时发出，歌单骨架屏立即出现 */
async function changePlSource(s: string): Promise<void> {
  if (plSource.value === s) return
  plSource.value = s
  plPage.value = 1
  plFurthest.value = 1
  plHasNext.value = true
  cat.value = '全部'
  tagOpen.value = false
  void call<PlaylistTagGroup[]>('music:playlistTags', { source: s })
    .then(gs => {
      if (plSource.value !== s) return // 已切到别的源，丢弃过期结果
      if (gs.length) {
        // 新源的标签整体替换（标签名即 id 的场景由后端提供）
        TAG_GROUPS.value = gs
        tagSupported.value = true
      } else {
        TAG_GROUPS.value = []
        tagSupported.value = false
      }
    })
    .catch(() => {
      if (plSource.value !== s) return
      TAG_GROUPS.value = []
      tagSupported.value = false
    })
  void loadPlaylists(1)
}

const groups = computed(() => tree.value?.tree[platform.value]?.groups || [])

const plError = ref('')

/** SWR 后台缓存：切标签/音源/最新最热/榜单时先用缓存秒开，再 30s 防抖后台静默刷新 */
const SWR_BG_MS = 30_000
const plCache = new Map<string, { list: PlaylistMeta[]; ts: number }>()
/** 请求序号：只让最后一次歌单请求的结果落到界面，避免快速切标签时旧结果覆盖新结果 */
let plReqSeq = 0
const tlCache = new Map<string, { r: { name: string; songs: Song[] }; ts: number }>()

/**
 * 加载某一页（落雪式真分页，替换原先的「加载更多」无限累加）。
 * 上游按页返回 30 条，不提供总数，故满页即认为还有下一页。
 * 「最新」走精品歌单通道（无总数、用 lasttime 游标翻页），冷门标签可能不足 30 条。
 */
async function loadPlaylists(page = 1): Promise<void> {
  // 请求序号：无论命中缓存还是走网络，本次请求都占用一个序号，
  // 让仍在飞的旧请求结果作废（否则快速切标签时旧结果会盖掉新内容）
  const seq = ++plReqSeq
  const key = `pl|${plSource.value}|${catId.value}|${order.value}|${page}`
  const hit = plCache.get(key)
  if (hit) {
    // 命中缓存：立即渲染（无骨架等待），**无论缓存多新都后台刷新**——
    // v2.3.2 修复「切换歌单没反馈、要手动刷新」：原先 30s 防抖会吞掉切换后的
    // 后台刷新，用户看到的永远是旧列表且无任何更新迹象
    applyPlaylists(hit.list, page)
    window.scrollTo({ top: 0 })
    void revalidatePlaylists(key, page, true)
    return
  }
  plLoading.value = true
  plError.value = ''
  try {
    const list = await call<PlaylistMeta[]>('music:playlists', {
      cat: catId.value,
      order: order.value,
      page,
      source: plSource.value,
    })
    // 空结果不入缓存：上游偶发返回空（风控/限流）时不应把「没有歌单」粘住
    if (list.length) plCache.set(key, { list, ts: Date.now() })
    if (seq !== plReqSeq) return
    applyPlaylists(list, page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e: any) {
    if (seq !== plReqSeq) return
    playlists.value = []
    plError.value = e?.message || '歌单加载失败'
    ui.toast(`歌单加载失败：${e.message}`, 'error')
  } finally {
    if (seq === plReqSeq) plLoading.value = false
  }
}

function applyPlaylists(list: PlaylistMeta[], page: number): void {
  playlists.value = list
  plPage.value = page
  if (page > plFurthest.value) plFurthest.value = page
  plHasNext.value = list.length >= 30
  if (!list.length) plError.value = '该标签暂无歌单，换个标签试试'
  else plError.value = ''
}

/** 后台静默刷新缓存数据；仅当该 key 仍是当前视图时替换界面。
 *  force=true：用户主动切换触发的刷新，绕过 30s 防抖（保证切了就有新数据） */
async function revalidatePlaylists(key: string, page: number, force = false): Promise<void> {
  const hit = plCache.get(key)
  if (!hit) return
  if (!force && Date.now() - hit.ts < SWR_BG_MS) return
  try {
    const list = await call<PlaylistMeta[]>('music:playlists', {
      cat: catId.value,
      order: order.value,
      page,
      source: plSource.value,
    })
    if (list.length) plCache.set(key, { list, ts: Date.now() })
    if (`pl|${plSource.value}|${catId.value}|${order.value}|${plPage.value}` === key) {
      applyPlaylists(list, page)
    }
  } catch {
    /* 后台刷新失败：保留缓存内容 */
  }
}

async function loadTree(): Promise<void> {
  treeLoading.value = true
  try {
    tree.value = await call<ToplistTree>('music:toplists')
    const keys = Object.keys(tree.value.tree)
    if (keys.length && !keys.includes(platform.value)) platform.value = keys[0]
    const firstGroup = tree.value.tree[platform.value]?.groups?.[0]
    const first = firstGroup?.items?.find(i => i.id)
    if (first) await selectToplist(first.n, first.id!)
  } catch (e: any) {
    ui.toast(`榜单加载失败：${e.message}`, 'error')
  } finally {
    treeLoading.value = false
  }
}

async function selectToplist(name: string, id: string): Promise<void> {
  currentItem.value = { name, id }
  tlPage.value = 1
  const key = `tl|${platform.value}|${id}`
  const hit = tlCache.get(key)
  if (hit) {
    // 命中缓存：榜单秒开，后台刷新
    toplistSongs.value = hit.r.songs
    tlLoading.value = false
    tlError.value = hit.r.songs.length ? '' : '该榜单暂时没有返回数据'
    void revalidateToplist(key, name, id)
    return
  }
  tlLoading.value = true
  tlError.value = ''
  toplistSongs.value = []
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:toplist', { platform: platform.value, id })
    tlCache.set(key, { r, ts: Date.now() })
    toplistSongs.value = r.songs
    if (!r.songs.length) tlError.value = '该榜单暂时没有返回数据'
  } catch (e: any) {
    tlError.value = e?.message || '榜单加载失败'
  } finally {
    tlLoading.value = false
  }
}

/** 榜单后台静默刷新；仅当 key 仍是当前榜单时替换 */
async function revalidateToplist(key: string, name: string, id: string): Promise<void> {
  const hit = tlCache.get(key)
  if (!hit || Date.now() - hit.ts < SWR_BG_MS) return
  try {
    const r = await call<{ name: string; songs: Song[] }>('music:toplist', { platform: platform.value, id })
    tlCache.set(key, { r, ts: Date.now() })
    if (`tl|${platform.value}|${id}` === key) {
      toplistSongs.value = r.songs
      tlError.value = r.songs.length ? '' : '该榜单暂时没有返回数据'
    }
  } catch {
    /* 后台刷新失败保留缓存 */
  }
}

async function changePlatform(p: string): Promise<void> {
  platform.value = p
  const firstGroup = tree.value?.tree[p]?.groups?.[0]
  const first = firstGroup?.items?.find(i => i.id)
  if (first) await selectToplist(first.n, first.id!)
  else {
    currentItem.value = null
    toplistSongs.value = []
  }
}

function openPlaylist(pl: PlaylistMeta): void {
  router.push({ path: `/playlist/${pl.id}`, query: { src: pl.source || 'wy', name: pl.name } })
}

async function playPlaylist(pl: PlaylistMeta): Promise<void> {
  try {
    const r = await call<{ songs: Song[]; name: string }>('music:playlist', { id: pl.id, source: pl.source || 'wy' })
    if (!r.songs.length) throw new Error('歌单为空')
    await player.playSongs(r.songs, 0)
    ui.toast(`正在播放：${r.name}`, 'success', 1800)
  } catch (e: any) {
    ui.toast(e.message, 'error')
  }
}

async function playToplist(): Promise<void> {
  if (!toplistSongs.value.length) return
  await player.playSongs(toplistSongs.value, 0)
}

async function loadNew(): Promise<void> {
  newLoading.value = true
  try {
    newSongs.value = await call<Song[]>('music:new')
  } catch (e: any) {
    ui.toast(`新歌加载失败：${e.message}`, 'error')
  } finally {
    newLoading.value = false
  }
}

function setTab(t: Tab): void {
  tab.value = t
  router.replace({ path: '/discover', query: { ...route.query, tab: t } })
}

function selectCat(c: string): void {
  closeTags()
  if (cat.value === c) return
  cat.value = c
  router.replace({ path: '/discover', query: { ...route.query, tab: 'playlists', cat: c } })
  void loadPlaylists(1)
}

function setOrder(o: 'hot' | 'new'): void {
  if (order.value === o) return
  order.value = o
  void loadPlaylists(1)
}

function goPage(p: number): void {
  if (p < 1 || p > plFurthest.value + 1 || p === plPage.value) return
  void loadPlaylists(p)
}

watch(
  () => route.query,
  q => {
    if (q.tab && q.tab !== tab.value) tab.value = q.tab as Tab
    if (typeof q.cat === 'string' && q.cat !== cat.value) {
      cat.value = q.cat
      if (tab.value === 'playlists') void loadPlaylists(1)
    }
  }
)

onMounted(() => {
  void loadPlaylists(1)
  void loadTree()
  void loadNew()
  syncTagPopupWidth()
  window.addEventListener('resize', syncTagPopupWidth)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncTagPopupWidth)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <div class="page discover">
    <header class="page-head">
      <div>
        <h1>发现音乐</h1>
        <p>歌单、榜单、新歌，一站听遍全平台</p>
      </div>
    </header>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'playlists' }" @click="setTab('playlists')">
        <Icon name="list" :size="15" />推荐歌单
      </button>
      <button class="tab" :class="{ active: tab === 'toplists' }" @click="setTab('toplists')">
        <Icon name="gauge" :size="15" />排行榜
      </button>
      <button class="tab" :class="{ active: tab === 'new' }" @click="setTab('new')">
        <Icon name="music" :size="15" />最新音乐
      </button>
    </div>

    <!-- 歌单 -->
    <section v-if="tab === 'playlists'" class="pane">
      <!-- 落雪式单行页头：折叠标签 + 音源 + 排序 + 导入 -->
      <div class="sl-header">
        <div class="sl-left">
          <div v-if="tagSupported" class="tag-select" :class="{ active: tagOpen }">
            <div class="tag-label" @click.stop="toggleTags">
              <span>{{ cat }}</span>
              <Icon name="chevron-down" :size="13" class="tag-arrow" />
            </div>
            <div class="tag-popup" :style="{ width: tagPopupWidth + 'px' }">
              <dl v-for="g in TAG_GROUPS" :key="g.name">
                <dt class="tag-type">{{ g.name }}</dt>
                <dd>
                  <span
                    v-for="t in g.tags"
                    :key="t.id"
                    class="cat-tag"
                    :class="{ active: cat === t.n }"
                    @click.stop="selectCat(t.n)"
                  >{{ t.n }}</span>
                </dd>
              </dl>
            </div>
          </div>
          <PlatformSelect v-model="plSource" :options="PL_SOURCES" label="" align="left" @update:model-value="changePlSource" />
          <div class="sort-tabs">
            <button class="sort-item" :class="{ active: order === 'hot' }" @click="setOrder('hot')">最热</button>
            <button class="sort-item" :class="{ active: order === 'new' }" @click="setOrder('new')">最新</button>
          </div>
        </div>
        <button class="btn" @click="ui.importDialog = true"><Icon name="download" :size="15" />导入歌单</button>
      </div>

      <div v-if="playlists.length" class="pl-grid">
        <PlaylistCard
          v-for="pl in playlists"
          :key="pl.id"
          layout="row"
          :playlist="pl"
          @open="openPlaylist(pl)"
          @play="playPlaylist(pl)"
        />
      </div>
      <div v-else-if="plLoading" class="pl-grid">
        <div v-for="i in 9" :key="i" class="sk" style="height: 108px; border-radius: 12px" />
      </div>
      <div v-else class="empty">
        <Icon name="list" :size="32" :stroke="1.3" />
        <div class="empty-title">没有找到歌单</div>
        <div class="empty-desc">{{ plError || '换个标签试试，或检查网络连接' }}</div>
      </div>

      <nav v-if="playlists.length" class="pagination" aria-label="分页">
        <button class="pg-btn" :disabled="!plCanPrev || plLoading" @click="goPage(plPage - 1)" title="上一页">
          <Icon name="chevron-left" :size="13" />上一页
        </button>
        <span class="pg-num active">第 {{ plPage }} 页</span>
        <button class="pg-btn" :disabled="!plCanNext || plLoading" @click="goPage(plPage + 1)" title="下一页">
          下一页<Icon name="chevron-right" :size="13" />
        </button>
      </nav>
    </section>

    <!-- 榜单 -->
    <section v-else-if="tab === 'toplists'" class="pane toplist-pane">
      <div class="tl-toolbar">
        <div class="tl-title">
          <span class="title-text">官方榜</span>
        </div>
        <PlatformSelect
          v-model="platform"
          :options="platforms"
          align="right"
          @update:model-value="changePlatform"
        />
      </div>

      <div class="tl-layout">
        <aside class="tl-side">
          <div v-if="treeLoading" class="tl-skeleton">
            <div v-for="i in 8" :key="i" class="sk" style="height: 28px; margin-bottom: 8px" />
          </div>
          <template v-else>
            <div v-for="g in groups" :key="g.g" class="tl-group">
              <div class="tl-group-name">{{ g.g }}</div>
              <button
                v-for="item in g.items"
                :key="item.n + (item.id || '')"
                class="tl-item"
                :class="{ active: currentItem?.id === item.id && currentItem?.name === item.n }"
                :aria-label="item.n"
                :title="item.freq || item.n"
                :disabled="!item.id"
                @click="item.id && selectToplist(item.n, item.id)"
              >
                <Icon
                  v-if="item.id && currentItem?.id === item.id && currentItem?.name === item.n"
                  name="chevron-right"
                  :size="12"
                  class="tl-active-icon"
                />
                <img v-if="item.pic && item.id" class="tl-thumb" :src="item.pic" alt="" loading="lazy" />
                <span class="ellipsis tl-item-text">{{ item.n }}</span>
                <Icon v-if="!item.id" name="lock" :size="11" class="lock" />
              </button>
            </div>
          </template>
        </aside>

        <div class="tl-main">
          <div class="tl-head">
            <div>
              <h2>{{ currentItem?.name || '选择榜单' }}</h2>
              <span class="tl-count">{{ toplistSongs.length }} 首</span>
              <span v-if="currentFreq" class="tl-count tl-freq">· {{ currentFreq }}</span>
            </div>
            <button class="btn primary sm" :disabled="!toplistSongs.length" @click="playToplist">
              <Icon name="play" :size="13" />播放全部
            </button>
          </div>
          <div v-if="tlError" class="empty" style="padding: 40px">
            <Icon name="info" :size="28" :stroke="1.3" />
            <div class="empty-desc">{{ tlError }}</div>
          </div>
          <template v-else>
            <SongList :songs="tlPaged" :loading="tlLoading" :show-album="true" empty-text="该榜单暂无数据" />
            <nav v-if="tlTotalPages > 1" class="pagination" aria-label="分页">
              <button class="pg-btn" :disabled="tlPage === 1" @click="tlPage = 1" title="首页">
                <Icon name="chevron-left" :size="13" />
                <Icon name="chevron-left" :size="13" style="margin-left: -7px" />
              </button>
              <button class="pg-btn" :disabled="tlPage === 1" @click="tlPage--" title="上一页">
                <Icon name="chevron-left" :size="13" />
              </button>
              <button
                v-for="p in tlTotalPages"
                :key="p"
                class="pg-num"
                :class="{ active: p === tlPage }"
                @click="tlPage = p"
              >{{ p }}</button>
              <button class="pg-btn" :disabled="tlPage === tlTotalPages" @click="tlPage++" title="下一页">
                <Icon name="chevron-right" :size="13" />
              </button>
              <button class="pg-btn" :disabled="tlPage === tlTotalPages" @click="tlPage = tlTotalPages" title="末页">
                <Icon name="chevron-right" :size="13" />
                <Icon name="chevron-right" :size="13" style="margin-left: -7px" />
              </button>
            </nav>
          </template>
        </div>
      </div>
    </section>

    <!-- 新歌 -->
    <section v-else class="pane">
      <div class="section-head" style="margin-top: 4px">
        <div>
          <div class="section-title">新歌速递</div>
          <div class="section-sub">来自在线音源的最新上架单曲</div>
        </div>
        <button class="btn sm" :disabled="!newSongs.length" @click="player.playSongs(newSongs, 0)">
          <Icon name="play" :size="13" />播放全部
        </button>
      </div>
      <SongList :songs="newSongs" :loading="newLoading" empty-text="暂无新歌数据" />
    </section>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-top: 14px;
}
.page-head h1 {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.page-head p {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-3);
}
.tabs {
  display: flex;
  gap: 4px;
  margin: 18px 0 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--text-2);
  position: relative;
  border-radius: 8px 8px 0 0;
}
.tab:hover {
  color: var(--text);
  background: var(--hover);
}
.tab.active {
  color: var(--text);
  font-weight: 600;
}
.tab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
/* 落雪式单行页头：折叠标签 + 排序 + 导入按钮同排 */
.sl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 18px;
}
.sl-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tag-select {
  position: relative;
}
.tag-label {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
  transition: background 0.18s var(--ease), color 0.18s var(--ease);
}
.tag-label:hover {
  background: var(--hover);
  color: var(--text);
}
.tag-arrow {
  transition: transform 0.2s var(--ease);
}
.tag-select.active .tag-label {
  color: var(--text);
  background: var(--hover);
}
.tag-select.active .tag-arrow {
  transform: rotate(180deg);
}
.tag-popup {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 10px;
  max-height: 250px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 8px;
  /* 浮层要实底：--panel 是半透明色，下层歌单文字会透上来与标签叠在一起 */
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.75);
  opacity: 0;
  transform: scale(0.95, 0.8);
  transform-origin: 0 0 0;
  transition: 0.25s ease;
  pointer-events: none;
  z-index: 30;
}
.tag-select.active .tag-popup {
  opacity: 1;
  transform: scale(1);
  pointer-events: initial;
}
.tag-popup dl {
  margin: 0;
}
.tag-type {
  padding-top: 10px;
  padding-bottom: 3px;
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 0.5px;
}
/* 类名用 cat-tag 而非 tag：main.css 有全局 .tag（height:16px/border:1px/line-height:1
   歌曲类型徽标），scoped 只覆盖自声明属性，漏网的 height/border 会把胶囊压成字沉底错位 */
.cat-tag {
  display: inline-block;
  margin: 5px;
  padding: 7px 11px;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: normal;
  height: auto;
  border: 0;
  color: var(--text-2);
  background: var(--panel-2);
  cursor: pointer;
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}
.cat-tag:hover {
  background: var(--hover);
  color: var(--text);
}
.cat-tag.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.sort-tabs {
  display: flex;
  gap: 2px;
  flex: none;
}
.sort-item {
  height: 34px;
  padding: 0 13px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}
.sort-item:hover {
  color: var(--text);
  background: var(--hover);
}
.sort-item.active {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 500;
}
.chips-strip {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 8px 0 6px;
  margin-bottom: 12px;
}
.chips-groups {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.chips-group {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.chips-group.on {
  background: var(--accent-soft, rgba(167, 139, 250, 0.14));
  color: var(--accent);
}
.chips-tags {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0 16px;
}
.chips-tags::-webkit-scrollbar {
  display: none;
}
.chips-tag {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.chips-tag.active {
  background: var(--accent-soft, rgba(167, 139, 250, 0.12));
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.pl-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px 18px;
}
.platform-tabs {
  display: flex;
  gap: 7px;
  margin-bottom: 14px;
}
.tl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.tl-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.tl-title .title-text {
  position: relative;
  padding-left: 10px;
}
.tl-title .title-text::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}
.tl-layout {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.tl-side {
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  padding-right: 6px;
  position: sticky;
  top: 8px;
}
.tl-group {
  margin-bottom: 12px;
}
.tl-group-name {
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--text-3);
  padding: 0 8px 5px;
  text-transform: uppercase;
}
.tl-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  text-align: left;
}
.tl-item-text {
  flex: 1;
  min-width: 0;
}
.tl-thumb {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--panel-2);
}
.tl-active-icon {
  flex: none;
  margin-left: -6px;
  color: inherit;
}
.tl-item:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.tl-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.tl-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.lock {
  color: var(--text-3);
}
.tl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tl-head h2 {
  font-size: 18px;
  font-weight: 650;
}
.tl-count {
  font-size: 11.5px;
  color: var(--text-3);
}
.tl-freq {
  color: var(--accent);
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 18px 0 4px;
}
.pg-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--panel);
  border: 1px solid transparent;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.pg-num {
  padding: 0 6px;
}
.pg-btn:hover:not(:disabled),
.pg-num:hover:not(.active) {
  background: var(--panel-2);
  color: var(--text);
  border-color: var(--line-2);
}
.pg-num.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-soft);
  font-weight: 600;
}
.pg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
@media (max-width: 1300px) {
  .pl-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
