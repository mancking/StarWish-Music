<script setup lang="ts">
/**
 * 歌词面板（规格书 1.3）
 *
 * - phone：16px / 行高 2.4 / 当前行 #A78BFA / 其他 #63636F / 居中
 * - pad：14px / 行高 2.2 / 左对齐 / 当前行白色 600
 * - desktop：14px / 行高 2.2 / 左对齐 / 当前行白色 600（外面还有 11px "LYRICS" 小标题）
 *
 * 点击任意行跳转到该行时间点（手机 / 平板 / 桌面都必须实现）。
 * 卡拉OK 逐字高亮：仅当前行按单字拆分 span（当前字 100% 主色、其余字 40%
 * 透明度），其余行整行着色（性能约定，规格书 1.3）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { LyricViewLine } from '@/player-music/lyrics'
import { wordProgress } from '@/player-music/lyrics'

const props = withDefaults(
  defineProps<{
    lines: LyricViewLine[]
    activeIndex: number
    variant?: 'phone' | 'pad' | 'desktop'
    /** 当前播放位置（秒）：逐字着色按它推进 */
    position?: number
  }>(),
  { variant: 'phone', position: 0 }
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

/** 当前行逐字进度（0~1 数组）；无逐字数据返回 null 走整行渲染 */
const activeChars = computed(() => {
  const line = props.lines[props.activeIndex]
  if (!line?.words?.length) return null
  const prog = wordProgress(line, props.position)
  if (!prog) return null
  // 按字拆分（含代理对安全拆分）：与 words 一一对应
  return line.words.map((w, i) => ({
    text: w.w,
    state: (prog[i] || 0) >= 1 ? 'done' : (prog[i] || 0) > 0 ? 'now' : 'todo',
  }))
})
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
        <template v-if="i === activeIndex && activeChars">
          <span
            v-for="(c, ci) in activeChars"
            :key="ci"
            class="karaoke"
            :class="`k-${c.state}`"
            >{{ c.text }}</span
          >
        </template>
        <span v-else class="txt">{{ l.text || '♪' }}</span>
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
/* 卡拉OK 逐字（规格书 1.3）：当前字 100% 主色、其余 40% 透明 */
.karaoke {
  display: inline;
}
.k-done,
.k-now {
  opacity: 1;
}
.k-todo {
  opacity: 0.4;
}
.is-phone .k-done,
.is-phone .k-now {
  color: #a78bfa;
}
.is-pad .k-done,
.is-pad .k-now,
.is-desktop .k-done,
.is-desktop .k-now {
  color: #a78bfa;
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
