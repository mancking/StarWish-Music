<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { useDownloadStore } from '@/stores/download'
import { useUiStore } from '@/stores/ui'
import { call } from '@/api'

/**
 * 下载管理页。
 *
 * 分两段：进行中（含排队）在上，已完成在下。
 * 已完成项支持「在文件夹中显示」与「删除文件」——删除是物理删除，
 * 所以二次确认放在按钮的 title 上，并用 ghost 样式降低误触。
 */

const dl = useDownloadStore()
const ui = useUiStore()

const running = computed(() => dl.active)
const done = computed(() => dl.finished)

const totalSize = computed(() => done.value.reduce((s, t) => s + (t.total || 0), 0))

function pct(t: { progress: number }): number {
  return Math.max(0, Math.min(100, Math.round((t.progress || 0) * 100)))
}

function statusText(t: { status: string; error?: string }): string {
  if (t.status === 'queued') return '排队中'
  if (t.status === 'running') return '下载中'
  if (t.status === 'paused') return '已暂停'
  if (t.status === 'done') return '已完成'
  if (t.status === 'canceled') return '已取消'
  return t.error || '失败'
}

/** 规格书 3.5：暂停 / 继续（继续即从头重下，不做断点续传） */
async function togglePause(t: { id: string; status: string }): Promise<void> {
  if (t.status === 'paused') {
    await dl.resume(t.id)
    ui.toast('已继续下载', 'info', 1400)
  } else {
    await dl.pause(t.id)
    ui.toast('已暂停', 'info', 1400)
  }
}

async function reveal(file?: string): Promise<void> {
  if (!file) return
  await call('app:showItemInFolder', { path: file }).catch(() => ui.toast('打开失败', 'error'))
}

async function remove(id: string, withFile: boolean): Promise<void> {
  await dl.remove(id, withFile)
  ui.toast(withFile ? '已删除文件' : '已从列表移除', 'info', 1600)
}

async function changeDir(): Promise<void> {
  const p = await dl.pickDir()
  if (p) ui.toast('下载目录已更新', 'success', 1600)
}

async function clearAll(): Promise<void> {
  await dl.clear(true)
  ui.toast('已清空完成记录', 'info', 1600)
}

onMounted(() => void dl.init())
</script>

<template>
  <div class="page downloads">
    <header class="head">
      <div>
        <h1>下载</h1>
        <p>{{ running.length ? `${running.length} 个任务进行中` : '没有进行中的任务' }} · 已完成 {{ done.length }} 首</p>
      </div>
      <div class="head-actions">
        <button class="btn sm ghost" @click="changeDir"><Icon name="folder-open" :size="14" />更改目录</button>
        <button class="btn sm ghost" @click="dl.openDir()"><Icon name="external" :size="14" />打开目录</button>
        <button v-if="done.length" class="btn sm ghost" @click="clearAll"><Icon name="trash" :size="14" />清空记录</button>
      </div>
    </header>

    <div class="dir-bar">
      <Icon name="folder" :size="14" />
      <span>{{ dl.dir || '默认目录' }}</span>
      <span v-if="totalSize" class="size">已下载 {{ dl.fmtBytes(totalSize) }}</span>
    </div>

    <section v-if="running.length" class="block">
      <h2>进行中</h2>
      <div v-for="t in running" :key="t.id" class="row">
        <Cover :src="t.song.pic" :size="42" radius="9" />
        <div class="meta">
          <b>{{ t.song.name }}</b>
          <span>{{ t.song.singer }}<template v-if="t.total"> · {{ dl.fmtBytes(t.received) }} / {{ dl.fmtBytes(t.total) }}</template></span>
        </div>
        <div class="bar">
          <div class="bar-fill" :style="{ width: pct(t) + '%' }" />
        </div>
        <span class="pct">{{ t.status === 'queued' ? '排队' : t.status === 'paused' ? '已暂停' : pct(t) + '%' }}</span>
        <button
          class="icon-btn"
          :title="t.status === 'paused' ? '继续下载' : '暂停下载'"
          @click="togglePause(t)"
        >
          <Icon :name="t.status === 'paused' ? 'play-circle' : 'pause'" :size="15" />
        </button>
        <button class="icon-btn" title="取消" @click="dl.cancel(t.id)"><Icon name="close" :size="15" /></button>
      </div>
    </section>

    <section class="block">
      <h2>已完成</h2>
      <div v-if="!done.length" class="empty">
        <Icon name="download" :size="30" :stroke="1.3" />
        <p>还没有下载过歌曲</p>
        <span>在歌曲列表右键，或播放页菜单中选择「下载」</span>
      </div>
      <div v-for="t in done" :key="t.id" class="row" :class="{ failed: t.status === 'error' }">
        <Cover :src="t.song.pic" :size="42" radius="9" />
        <div class="meta">
          <b>{{ t.song.name }}</b>
          <span>{{ t.song.singer }} · {{ statusText(t) }}</span>
        </div>
        <span class="pct">{{ t.total ? dl.fmtBytes(t.total) : '' }}</span>
        <div class="ops">
          <button v-if="t.file" class="icon-btn" title="在文件夹中显示" @click="reveal(t.file)">
            <Icon name="folder-open" :size="15" />
          </button>
          <button class="icon-btn" title="移除记录" @click="remove(t.id, false)"><Icon name="close" :size="15" /></button>
          <button v-if="t.file" class="icon-btn danger" title="删除文件" @click="remove(t.id, true)">
            <Icon name="trash" :size="15" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
}
.head h1 {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px;
}
.head p {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-3);
}
.head-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.dir-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  font-size: 12.5px;
  color: var(--text-2);
}
.dir-bar .size {
  margin-left: auto;
  color: var(--text-3);
}

.block h2 {
  font-size: 15px;
  font-weight: 650;
  margin: 0 0 10px;
}

.row {
  display: grid;
  grid-template-columns: 42px minmax(140px, 1.6fr) minmax(80px, 2fr) 56px 40px;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  min-height: var(--row-h, 52px);
}
.row:hover {
  background: var(--hover);
}
.row.failed .meta b {
  color: var(--text-2);
}
.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta b {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta span {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar {
  height: 4px;
  border-radius: 3px;
  background: var(--panel-2);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.2s linear;
}
.pct {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: right;
}
.ops {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}
.icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--panel-2);
  color: var(--text);
}
.icon-btn.danger:hover {
  color: #ff5a6a;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 20px;
  color: var(--text-3);
}
.empty p {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--text-2);
}
.empty span {
  font-size: 12px;
}
</style>
