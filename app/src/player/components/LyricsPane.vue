<script setup lang="ts">
/**
 * 歌词面板（规格书 1.3）
 *
 * - phone：16px / 行高 2.4 / 当前行 #A78BFA / 其他 #63636F / 居中
 * - pad：14px / 行高 2.2 / 左对齐 / 当前行白色 600
 * - desktop：14px / 行高 2.2 / 左对齐 / 当前行白色 600（外面还有 11px "LYRICS" 小标题）
 *
 * 点击任意行跳转到该行时间点（手机 / 平板 / 桌面都必须实现）。
 */
import { nextTick, ref, watch } from 'vue'
import type { LyricViewLine } from '@/player/lyrics'

const props = withDefaults(
  defineProps<{
    lines: LyricViewLine[]
    activeIndex: number
    variant?: 'phone' | 'pad' | 'desktop'
  }>(),
  { variant: 'phone' }
)

const emit = defineEmits<{ (e: 'seek', time: number): void }>()

const box = ref<HTMLElement | null>(null)
const rows = ref<HTMLElement[]>([])

function setRow(el: Element | null, i: number): void {
  if (el) rows.value[i] = el as HTMLElement
}

async function center(): Promise<void> {
  await nextTick()
  const el = rows.value[props.activeIndex]
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(() => props.activeIndex, center)
watch(
  () => props.lines.length,
  () => {
    rows.value = []
    void center()
  }
)
</script>

<template>
  <div ref="box" class="lyrics" :class="`is-${variant}`">
    <p v-if="!lines.length" class="empty">暂无歌词</p>
    <template v-else>
      <p
        v-for="(l, i) in lines"
        :key="`${l.time}-${i}`"
        :ref="el => setRow(el as Element | null, i)"
        class="row"
        :class="{ active: i === activeIndex }"
        @click="emit('seek', l.time)"
      >
        <span class="txt">{{ l.text || '♪' }}</span>
        <span v-if="l.trans" class="trans">{{ l.trans }}</span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.lyrics {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
}
.lyrics::-webkit-scrollbar {
  display: none;
}
.row {
  margin: 0;
  cursor: pointer;
  transition: color 180ms ease;
}
.txt {
  display: block;
}
.trans {
  display: block;
  font-size: 0.86em;
  opacity: 0.85;
  margin-top: 2px;
}
.empty {
  margin: 0;
  text-align: center;
  color: #63636f;
  font-size: 14px;
}
/* 手机：居中、16px、行高 2.4 */
.is-phone {
  padding: 24px 20px;
  text-align: center;
}
.is-phone .row {
  font-size: 16px;
  line-height: 2.4;
  color: #63636f;
  padding: 2px 0;
}
.is-phone .row.active {
  color: #a78bfa;
}
/* 平板 / 桌面：左对齐、14px、行高 2.2、当前行白色 600 */
.is-pad,
.is-desktop {
  padding: 12px 18px;
  text-align: left;
}
.is-pad .row,
.is-desktop .row {
  font-size: 14px;
  line-height: 2.2;
  color: #63636f;
}
.is-pad .row.active,
.is-desktop .row.active {
  color: #ececf1;
  font-weight: 600;
}
</style>
