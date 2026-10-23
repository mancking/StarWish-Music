<script setup lang="ts">
/**
 * 视频播放设置面板（规格书 2.2 / 2.3 / 2.4 / 2.7 / 2.9 / 2.11 / 2.12）
 *
 * 移动端是底部抽屉，桌面是右侧弹出面板，两者共用这一份结构：
 * 画质 / 倍速 / 画面 / 循环与 AB / 其它（画中画、音频模式、字幕延迟）。
 * 车机端不渲染本面板（规格书 3.0：车机隐藏循环、适应、画质菜单）。
 */
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'

export interface QualityOption {
  id: string
  label: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    variant?: 'sheet' | 'popover'
    qualities?: QualityOption[]
    quality?: string
    rate?: number
    fill?: 'contain' | 'cover' | 'fill' | 'actual'
    loopMode?: 'off' | 'one' | 'list'
    abA?: number | null
    abB?: number | null
    pipSupported?: boolean
    audioMode?: boolean
    subtitleDelay?: number
    /** 本地视频隐藏画质（规格书 2.4） */
    localVideo?: boolean
  }>(),
  {
    variant: 'sheet',
    qualities: () => [],
    quality: '',
    rate: 1,
    fill: 'contain',
    loopMode: 'off',
    abA: null,
    abB: null,
    pipSupported: true,
    audioMode: false,
    subtitleDelay: 0,
    localVideo: false,
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'quality', id: string): void
  (e: 'rate', v: number): void
  (e: 'fill'): void
  (e: 'loop', mode: 'off' | 'one' | 'list'): void
  (e: 'ab'): void
  (e: 'pip'): void
  (e: 'audio'): void
  (e: 'subtitle', delta: number): void
}>()

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const FILL_LABEL: Record<string, string> = {
  contain: '适应窗口',
  cover: '填充',
  fill: '拉伸',
  actual: '100%',
}
const LOOP_LABEL: Record<string, string> = { off: '不循环', one: '单片循环', list: '列表循环' }

const abLabel = computed(() => {
  if (props.abA === null) return 'AB 循环'
  if (props.abB === null) return 'A 已设 · 再点设 B'
  return 'AB 循环已开'
})
</script>

<template>
  <div v-if="open" class="mask" :class="variant" @click.self="emit('close')">
    <div class="panel">
      <div class="grip" />
      <header class="head">
        <b>播放设置</b>
        <button class="done" @click="emit('close')">完成</button>
      </header>

      <section v-if="!localVideo && qualities.length" class="sec">
        <h4>画质</h4>
        <div class="scroll">
          <button
            v-for="q in qualities"
            :key="q.id"
            class="chip"
            :class="{ on: q.id === quality }"
            @click="emit('quality', q.id)"
          >
            {{ q.label }}
          </button>
        </div>
      </section>

      <section class="sec">
        <h4>倍速</h4>
        <div class="scroll">
          <button
            v-for="r in RATES"
            :key="r"
            class="chip"
            :class="{ on: r === rate }"
            @click="emit('rate', r)"
          >
            {{ r }}x
          </button>
        </div>
      </section>

      <section class="sec">
        <h4>画面</h4>
        <div class="scroll">
          <button class="chip" @click="emit('fill')">{{ FILL_LABEL[fill] }}</button>
        </div>
      </section>

      <section class="sec">
        <h4>循环</h4>
        <div class="grid">
          <button
            v-for="(label, mode) in LOOP_LABEL"
            :key="mode"
            class="cell"
            :class="{ on: loopMode === mode }"
            @click="emit('loop', mode as 'off' | 'one' | 'list')"
          >
            {{ label }}
          </button>
          <button class="cell" :class="{ on: abA !== null }" @click="emit('ab')">{{ abLabel }}</button>
        </div>
      </section>

      <section class="sec">
        <h4>其它</h4>
        <div class="grid">
          <button v-if="pipSupported" class="cell" @click="emit('pip')">
            <Icon name="cast" :size="15" /> 画中画
          </button>
          <button class="cell" :class="{ on: audioMode }" @click="emit('audio')">
            <Icon name="headphones" :size="15" /> 音频模式
          </button>
          <button class="cell" @click="emit('subtitle', -0.5)">字幕 −0.5s</button>
          <button class="cell" @click="emit('subtitle', 0.5)">字幕 +0.5s</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.mask.popover {
  align-items: center;
  justify-content: flex-end;
}
.panel {
  width: 100%;
  max-height: 56vh;
  overflow-y: auto;
  padding: 8px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px 18px 0 0;
  background: #13131b;
  border: 1px solid #262633;
}
.mask.popover .panel {
  width: 320px;
  max-height: 70vh;
  border-radius: 14px;
  margin-right: 16px;
}
.grip {
  width: 36px;
  height: 4px;
  margin: 4px auto 8px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0 8px;
}
.head b {
  font-size: 15px;
  color: #ececf1;
}
.done {
  border: 0;
  background: transparent;
  color: #a78bfa;
  font-size: 14px;
  cursor: pointer;
}
.sec {
  padding: 8px 0;
}
.sec h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: #9b9ba8;
}
.scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.scroll::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 13px;
  cursor: pointer;
}
.chip.on {
  border-color: #f472b6;
  color: #f472b6;
  background: rgba(244, 114, 182, 0.12);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid #262633;
  background: rgba(255, 255, 255, 0.03);
  color: #ececf1;
  font-size: 13px;
  cursor: pointer;
}
.cell.on {
  border-color: #f472b6;
  color: #f472b6;
  background: rgba(244, 114, 182, 0.12);
}
</style>
