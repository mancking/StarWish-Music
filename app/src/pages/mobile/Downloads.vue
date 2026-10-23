<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Cover from '@/components/Cover.vue'
import { useDownloadStore } from '@/stores/download'

/**
 * 移动端下载管理页（与桌面 Downloads.vue 完全独立）。
 *
 * 设计差异：
 *  - 大卡片单列布局，封面 52px，信息两行，触达区域 ≥44px
 *  - 进度条做进卡片内部，不做桌面那种密集网格
 *  - 移动端已通过 SwBridge.saveToMedia 走原生媒体库落盘
 *    （目录 Music/星河音乐（系统音乐库）），因此与桌面版能力对齐
 */

const dl = useDownloadStore()

const running = computed(() => dl.active)
const done = computed(() => dl.finished)

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

/** 规格书 3.5：暂停 / 继续 */
async function togglePause(t: { id: string; status: string }): Promise<void> {
  if (t.status === 'paused') await dl.resume(t.id)
  else await dl.pause(t.id)
}

onMounted(() => void dl.init())
</script>

<template>
  <div class="page m-downloads">
    <header class="head">
      <h1>下载管理</h1>
      <p>{{ running.length ? `${running.length} 个任务进行中` : '没有进行中的任务' }}</p>
    </header>

    <!-- 保存位置说明（已接原生媒体库） -->
    <div class="notice">
      <Icon name="folder" :size="16" />
      <p>歌曲原格式保存到系统音乐库：Music/星河音乐（系统音乐库），可在系统音乐 App 中直接播放。</p>
    </div>

    <section v-if="running.length" class="block">
      <h2>进行中</h2>
      <div v-for="t in running" :key="t.id" class="card">
        <Cover :src="t.song.pic" :size="52" radius="10" />
        <div class="meta">
          <b>{{ t.song.name }}</b>
          <span>{{ t.song.singer }}</span>
          <div class="bar">
            <div class="bar-fill" :style="{ width: pct(t) + '%' }" />
          </div>
          <div class="row2">
            <span>{{ t.status === 'queued' ? '排队中' : t.status === 'paused' ? '已暂停' : `${pct(t)}% · ${dl.fmtBytes(t.received)} / ${dl.fmtBytes(t.total)}` }}</span>
            <button class="op" @click="togglePause(t)">
              <Icon :name="t.status === 'paused' ? 'play-circle' : 'pause'" :size="14" />{{ t.status === 'paused' ? '继续' : '暂停' }}
            </button>
            <button class="op" @click="dl.cancel(t.id)"><Icon name="close" :size="14" />取消</button>
          </div>
        </div>
      </div>
    </section>

    <section class="block">
      <h2>已完成 / 记录</h2>
      <div v-if="!done.length" class="empty">
        <Icon name="download" :size="34" :stroke="1.3" />
        <p>还没有下载记录</p>
        <span>在歌曲菜单里选择「下载」即可保存到系统音乐库</span>
      </div>
      <div v-for="t in done" :key="t.id" class="card" :class="{ failed: t.status === 'error' }">
        <Cover :src="t.song.pic" :size="52" radius="10" />
        <div class="meta">
          <b>{{ t.song.name }}</b>
          <span>{{ t.song.singer }} · {{ statusText(t) }}</span>
          <div class="row2">
            <span>{{ t.total ? dl.fmtBytes(t.total) : '' }}</span>
            <button class="op danger" @click="dl.remove(t.id)"><Icon name="trash" :size="14" />移除</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.m-downloads {
  padding: 18px 16px 28px;
}
.head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}
.head p {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-3);
}

.notice {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: var(--text-2);
}
.notice p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.notice :deep(svg) {
  flex: none;
  margin-top: 2px;
  color: var(--accent);
}

.block {
  margin-top: 20px;
}
.block h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 650;
}

.card {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.card.failed .meta b {
  color: var(--text-2);
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.meta b {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta > span {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar {
  height: 4px;
  margin-top: 4px;
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
.row2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
}
.row2 > span {
  font-size: 11.5px;
  color: var(--text-3);
}
.op {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  min-height: 32px;
}
.op.danger {
  color: #ff8b9c;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 20px;
  color: var(--text-3);
}
.empty p {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--text-2);
}
.empty span {
  font-size: 12px;
}
</style>
