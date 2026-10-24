<script setup lang="ts">
/**
 * EQ 音效面板（规格书 v2.7 · 1.11）
 * 6 预设（关闭/流行/摇滚/古典/人声/低音增强）+ 5 段滑块 ±12dB 步进 1dB。
 * 车机端只保留 关闭/人声/低音增强，隐藏手动滑块。
 * 手机是底部弹出面板，桌面是右侧抽屉 —— 由父级容器决定形态，本组件只管内容。
 */
import { computed } from 'vue'
import { applyEqPreset, EQ_FREQS, eqBands, eqCar, eqPreset, eqPresets, setEqBand } from '@/player-core/eq'
import { platform } from '@/platform'

const emit = defineEmits<{ (e: 'close'): void }>()

/** 桌面/平板用右侧抽屉，手机用底部弹出面板（规格书 1.11） */
const drawer = computed(() => platform.value.kind === 'desktop' || platform.value.kind === 'pad')

const labels = computed(() =>
  EQ_FREQS.map(f => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : String(f)))
)
const activeLabel = computed(
  () => eqPresets.value.find(p => p.key === eqPreset.value)?.label || '自定义'
)

function onBand(index: number, ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value)
  setEqBand(index, v)
}
</script>

<template>
  <div class="eq-mask" :class="{ wide: drawer }" @click.self="emit('close')">
    <div class="eq" :class="{ drawer, sheet: !drawer }">
      <header class="eq-head">
      <div>
        <b>音效</b>
        <span>{{ eqCar ? '驾驶场景仅保留三档预设' : activeLabel }}</span>
      </div>
      <button class="eq-close" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <div class="eq-presets">
      <button
        v-for="p in eqPresets"
        :key="p.key"
        class="eq-preset"
        :class="{ on: eqPreset === p.key }"
        @click="applyEqPreset(p.key)"
      >
        {{ p.label }}
      </button>
    </div>

    <div v-if="!eqCar" class="eq-bands">
      <div v-for="(f, i) in labels" :key="f" class="eq-band">
        <span class="eq-db">{{ eqBands[i] > 0 ? '+' : '' }}{{ eqBands[i] }}</span>
        <input
          class="eq-slider"
          type="range"
          :min="-12"
          :max="12"
          step="1"
          :value="eqBands[i]"
          :aria-label="`${f} 赫兹增益`"
          @input="onBand(i, $event)"
        />
        <span class="eq-freq">{{ f }}</span>
      </div>
    </div>
    <p v-else class="eq-tip">驾驶中不做手动调节，保证操作简洁。</p>
    </div>
  </div>
</template>

<style scoped>
.eq-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.eq-mask.wide {
  align-items: stretch;
  justify-content: flex-end;
}
.eq {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #ececf1;
  background: #13131b;
  border: 1px solid #262633;
}
.eq.sheet {
  width: 100%;
  max-width: 560px;
  padding: 18px 18px calc(20px + env(safe-area-inset-bottom));
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.45);
}
.eq.drawer {
  width: 340px;
  max-width: 90vw;
  height: 100%;
  padding: 20px;
  border-radius: 0;
  border-left: 1px solid #262633;
  overflow-y: auto;
  box-shadow: -18px 0 40px rgba(0, 0, 0, 0.45);
}
.eq-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.eq-head b {
  font-size: 15px;
  font-weight: 700;
}
.eq-head span {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: #9b9ba8;
}
.eq-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.eq-presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.eq-preset {
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: #ececf1;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s, color 0.16s;
}
.eq-preset:hover {
  background: rgba(255, 255, 255, 0.1);
}
.eq-preset.on {
  background: linear-gradient(135deg, #a78bfa, #f472b6);
  border-color: transparent;
  color: #0b0b10;
  font-weight: 700;
}
.eq-bands {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  padding: 6px 2px 0;
}
.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.eq-db {
  font-size: 11px;
  color: #a78bfa;
  font-variant-numeric: tabular-nums;
}
.eq-slider {
  width: 100%;
  height: 120px;
  accent-color: #a78bfa;
  writing-mode: vertical-lr;
  direction: rtl;
  cursor: pointer;
}
.eq-freq {
  font-size: 10.5px;
  color: #63636f;
}
.eq-tip {
  font-size: 12px;
  color: #9b9ba8;
}
</style>
