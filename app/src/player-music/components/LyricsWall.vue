<script setup lang="ts">
/**
 * 歌词墙背景
 *
 * 当前行 + 下一行超大字（32~48px）作为播放页背景层：
 * - blur 2~4px、opacity 0.15~0.25、pointer-events:none（纯背景，不抢前景）
 * - 与全屏歌词页（14~16px 滚动阅读）分层，不重叠
 * - 复用 useLyricSync 的 activeLine/nextLine 数据
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    current?: string
    next?: string
  }>(),
  { current: '', next: '' }
)

const cur = computed(() => (props.current || '').trim())
const nxt = computed(() => (props.next || '').trim())
/** 长句缩字号：>14 字缩到 32px，短句 48px（32~48px 区间） */
const curSize = computed(() => (cur.value.length > 18 ? 32 : cur.value.length > 10 ? 40 : 48))
</script>

<template>
  <div class="lwall" aria-hidden="true">
    <p v-if="cur" class="line cur" :style="{ fontSize: `${curSize}px` }">{{ cur }}</p>
    <p v-if="nxt" class="line next">{{ nxt }}</p>
    <p v-if="!cur && !nxt" class="line cur">星河音乐</p>
  </div>
</template>

<style scoped>
.lwall {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 18px;
  padding: 0 8%;
  overflow: hidden;
  pointer-events: none;
  opacity: 0.22;
  filter: blur(3px);
  transform: scale(1.08);
}
.line {
  margin: 0;
  font-weight: 700;
  line-height: 1.3;
  color: #ececf1;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.next {
  font-size: 32px;
  opacity: 0.55;
}
</style>
