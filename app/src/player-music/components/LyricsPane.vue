<script setup lang="ts">
/**
 * 歌词面板
 *
 * - 高亮行 21px / bold（手机）、19px（平板）、17px 600（桌面）；非高亮 16px rgba(255,255,255,.5)
 * - 行间距 ~20px；当前行垂直居中（ScrollAlign.CENTER）；暂停即停滚（跟随播放状态由数据驱动）
 * - 副行三态：无 / 翻译（音源歌词字段驱动），字号小 2px
 * - 卡拉OK 逐字渐变 reveal（主案）：当前行按字 background-clip:text 渐变填充，
 *   随行内进度 0→1 平滑推进（0.12s 前瞻已由 useLyricSync activeIndex + wordProgress 提供）；
 *   无逐字数据 / 低性能档降级三态离散（当前字 100% 主色、其余 40% 透明）
 * - 点击任意行 seek 到该行行首时间（逐字行点击 = 跳到该行行首，与整行口径一致）
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { LyricViewLine } from '@/player-music/lyrics'
import { wordProgress } from '@/player-music/lyrics'
import { platform } from '@/platform'

const props = withDefaults(
  defineProps<{
    lines: LyricViewLine[]
    activeIndex: number
    variant?: 'phone' | 'pad' | 'desktop'
    /** 当前播放位置（秒）：逐字着色按它推进 */
    position?: number
 /** 低性能档：逐字降级三态离散 */
    lowPerf?: boolean
  }>(),
  { variant: 'phone', position: 0, lowPerf: false }
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

const revealMode = computed(() => !props.lowPerf && platform.value.kind !== 'car')

/** 当前行逐字进度（0~1 数组）；无逐字数据返回 null 走整行渲染 */
const activeChars = computed(() => {
  const line = props.lines[props.activeIndex]
  if (!line?.words?.length) return null
  const prog = wordProgress(line, props.position)
  if (!prog) return null
  return line.words.map((w, i) => ({
    text: w.w,
    /** 0~1 填充比例，渐变 reveal 用 */
    p: Math.min(1, Math.max(0, prog[i] || 0)),
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
        <template v-if="i === activeIndex && activeChars && revealMode">
          <span
            v-for="(c, ci) in activeChars"
            :key="ci"
            class="karaoke reveal"
            :style="{ '--p': c.p }"
            >{{ c.text }}</span
          >
        </template>
        <template v-else-if="i === activeIndex && activeChars">
          <span
            v-for="(c, ci) in activeChars"
            :key="ci"
            class="karaoke"
            :class="c.p >= 1 ? 'k-done' : c.p > 0 ? 'k-now' : 'k-todo'"
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
  margin: 0 0 20px;
  cursor: pointer;
  transition: color 180ms ease, font-size 180ms ease;
}
.txt {
  display: block;
}
.trans {
  display: block;
  font-size: 0.86em;
  opacity: 0.85;
  margin-top: 4px;
}
.empty {
  margin: 0;
  text-align: center;
  color: #63636f;
  font-size: 14px;
}
/* ---- 卡拉OK 逐字---- */
.karaoke {
  display: inline;
}
/* 主案：background-clip:text 渐变 reveal（在唱字随行内进度 0→1 平滑填充） */
.karaoke.reveal {
  background-image: linear-gradient(
    90deg,
    #a78bfa calc(var(--p) * 100%),
    rgba(255, 255, 255, 0.4) calc(var(--p) * 100%)
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
/* 降级三态：当前字 100% 主色、其余 40% 透明 */
.k-done,
.k-now {
  opacity: 1;
  color: #a78bfa;
}
.k-todo {
  opacity: 0.4;
  color: #a78bfa;
}
/* ---- 手机：高亮行 21px/bold、非高亮 16px@50%、居中（3.14） ---- */
.is-phone {
  padding: 24px 20px;
  text-align: center;
}
.is-phone .row {
  font-size: 16px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.5);
}
.is-phone .row.active {
  font-size: 21px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.5;
}
/* ---- 平板：高亮 19px（等比缩放），左对齐 ---- */
.is-pad {
  padding: 12px 18px;
  text-align: left;
}
.is-pad .row {
  font-size: 16px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.5);
}
.is-pad .row.active {
  font-size: 19px;
  font-weight: 700;
  color: #ffffff;
}
/* ---- 桌面：高亮 17px 600，左对齐 ---- */
.is-desktop {
  padding: 12px 18px;
  text-align: left;
}
.is-desktop .row {
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.5);
}
.is-desktop .row.active {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
}
</style>
