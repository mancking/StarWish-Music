<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'

/**
 * 离线缓存管理器（视频 MV）。
 *
 * 桌面端从「我的音乐 → 本地音乐」下方进入、移动端从「我的」进入，
 * 替代此前只藏在 MV 播放器里的缓存弹层：全量列表、占用统计、
 * 单条删除与一键清空。数据通道 video:offline:*（桌面为真实文件；
 * 移动端暂无视频离线缓存能力，接口诚实返回空列表）。
 */
interface OfflineItem {
  key: string
  bvid: string
  cid: string
  title: string
  size: number
  savedAt: number
}

const router = useRouter()
const ui = useUiStore()

const items = ref<OfflineItem[]>([])
const total = ref(0)
const loading = ref(true)
const confirmClear = ref(false)

const list = computed(() =>
  [...items.value].sort((a, b) => b.savedAt - a.savedAt)
)

function fmtSize(n: number): string {
  if (!n) return '0 B'
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await call<{ items: OfflineItem[]; total: number }>('video:offline:list')
    items.value = r?.items || []
    total.value = r?.total || 0
  } catch (e: any) {
    ui.toast(e?.message || '缓存列表加载失败', 'error')
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function removeOne(key: string): Promise<void> {
  try {
    await call('video:offline:remove', { key })
    await load()
  } catch {
    ui.toast('删除失败', 'error')
  }
}

async function clearAll(): Promise<void> {
  try {
    await call('video:offline:remove', {})
    confirmClear.value = false
    await load()
    ui.toast('离线缓存已清空', 'success')
  } catch {
    ui.toast('清空失败', 'error')
  }
}

function openVideo(item: OfflineItem): void {
  void router.push(`/mv/${item.bvid}`)
}

onMounted(() => void load())
</script>

<template>
  <div class="page offline">
    <header class="head">
      <div>
        <h1>离线缓存</h1>
        <p>已缓存的视频与占用空间</p>
      </div>
      <button v-if="items.length" class="btn danger-soft" @click="confirmClear = true">
        <Icon name="trash" :size="14" />清空全部
      </button>
    </header>

    <div v-if="items.length" class="total-bar">
      <Icon name="database" :size="15" />
      <span>{{ items.length }} 个视频 · 共占用 <b>{{ fmtSize(total) }}</b></span>
    </div>

    <div v-if="loading" class="sk-list">
      <div v-for="i in 5" :key="i" class="sk" style="height: 56px; border-radius: 12px" />
    </div>

    <div v-else-if="!items.length" class="empty" style="padding: 70px 18px">
      <Icon name="database" :size="34" :stroke="1.3" />
      <div class="empty-title">暂无离线缓存</div>
      <div class="empty-desc">在视频播放页点击「离线缓存」后，可在这里统一管理</div>
      <button class="btn" style="margin-top: 12px" @click="router.push('/mv')">去逛视频</button>
    </div>

    <div v-else class="cache-list">
      <div v-for="it in list" :key="it.key" class="cache-row">
        <span class="c-icon"><Icon name="video" :size="17" /></span>
        <span class="c-meta">
          <span class="c-title ellipsis" @click="openVideo(it)">{{ it.title }}</span>
          <span class="c-sub">{{ fmtSize(it.size) }}<template v-if="fmtDate(it.savedAt)"> · {{ fmtDate(it.savedAt) }}</template></span>
        </span>
        <button class="c-del" aria-label="删除" @click="removeOne(it.key)">
          <Icon name="trash" :size="15" />
        </button>
      </div>
    </div>

    <Modal v-model="confirmClear" title="清空离线缓存" :width="360">
      <p style="font-size: 13px; line-height: 1.8">
        确定清空全部 {{ items.length }} 个离线视频吗？<br />
        <span style="color: var(--text-3)">释放 {{ fmtSize(total) }} 空间，此操作不可恢复。</span>
      </p>
      <template #footer>
        <button class="btn ghost" @click="confirmClear = false">取消</button>
        <button class="btn primary" @click="clearAll">确认清空</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0 14px;
}
.head h1 {
  font-size: 24px;
  font-weight: 800;
}
.head p {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--text-3);
}
.danger-soft {
  color: #ff5d5d;
  border-color: color-mix(in srgb, #ff5d5d 35%, transparent);
  background: color-mix(in srgb, #ff5d5d 10%, transparent);
}
.total-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 12px;
}
.total-bar b {
  color: var(--text);
}
.cache-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cache-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.c-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #ff4d6d 14%, transparent);
  color: #ff4d6d;
}
.c-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.c-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.c-title:hover {
  color: var(--accent);
}
.c-sub {
  font-size: 12px;
  color: var(--text-3);
}
.c-del {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 0;
  background: none;
  color: var(--text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.c-del:hover {
  color: #ff5d5d;
  background: color-mix(in srgb, #ff5d5d 10%, transparent);
}
.sk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
