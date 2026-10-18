<script setup lang="ts">
import Cover from './Cover.vue'
import Icon from './Icon.vue'
import { platformLabel } from '@/utils/labels'
import type { PlaylistMeta } from '@shared/types'

withDefaults(
  defineProps<{ playlist: PlaylistMeta; size?: number; showPlay?: boolean; layout?: 'grid' | 'row' }>(),
  {
    size: 0,
    showPlay: true,
    layout: 'grid',
  }
)

const emit = defineEmits<{ (e: 'open'): void; (e: 'play'): void }>()

function fmt(n?: number): string {
  const v = Number(n || 0)
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}亿`
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`
  return String(v)
}

/** 界面不出现官方软件名，只显示音源别名 */
function srcLabel(s?: string): string {
  return s ? platformLabel(s) : ''
}
</script>

<template>
  <div class="pl-card" :class="`layout-${layout}`" @click="emit('open')">
    <div class="art">
      <Cover :src="playlist.pic" :alt="playlist.name" size="100%" :radius="10" cover="1" class="cv" />
      <button v-if="showPlay" class="play" title="播放" @click.stop="emit('play')">
        <Icon name="play" :size="17" />
      </button>
    </div>
    <div class="body">
      <div class="name">{{ playlist.name }}</div>
      <div v-if="playlist.author" class="meta ellipsis">{{ playlist.author }}</div>
      <div class="stats">
        <span class="stat">
          <Icon name="music" :size="12" class="ic" />
          <span>{{ playlist.count || 0 }}</span>
        </span>
        <span v-if="playlist.played" class="stat">
          <Icon name="headphones" :size="12" class="ic" />
          <span>{{ fmt(playlist.played) }}</span>
        </span>
        <span v-if="playlist.source" class="stat src">{{ srcLabel(playlist.source) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pl-card {
  cursor: pointer;
  min-width: 0;
  user-select: none;
  display: flex;
  flex-direction: column;
}
.art {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  transition: transform 0.24s var(--ease), box-shadow 0.24s var(--ease);
  background: var(--panel);
}
.cv {
  width: 100%;
  height: 100%;
}
.pl-card:hover .art {
  transform: translateY(-3px);
  box-shadow: 0 18px 34px -18px rgba(0, 0, 0, 0.7);
}
.play {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #14161d;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transform: translateY(6px) scale(0.9);
  transition: all 0.2s var(--ease);
}
.pl-card:hover .play {
  opacity: 1;
  transform: none;
}
.play:hover {
  background: var(--accent);
  color: #fff;
}
.name {
  margin-top: 9px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.45;
  min-height: 36px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  white-space: nowrap;
}
.ic {
  color: var(--text-3);
}
.src {
  color: var(--text-3);
  opacity: 0.85;
}

/* 落雪式横向布局：图 40% 宽方形 + 右侧信息（发现页歌单用） */
.layout-row {
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}
.layout-row .art {
  flex: none;
  width: 40%;
  max-width: 148px;
  border-radius: 10px;
}
.layout-row:hover .art {
  transform: none;
  box-shadow: none;
}
.layout-row .play {
  right: 8px;
  bottom: 8px;
  width: 32px;
  height: 32px;
}
.layout-row .body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}
.layout-row .name {
  margin-top: 0;
  font-size: 13.5px;
  min-height: 0;
}
.layout-row .stats {
  margin-top: 8px;
  gap: 14px;
  font-size: 11.5px;
}
</style>
