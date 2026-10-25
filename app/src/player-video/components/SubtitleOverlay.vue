<script setup lang="ts">
/**
 * 字幕渲染层 ：VideoStage 叠加层，渲染当前活动字幕行。
 * 数据由父页经 subtitles.ts（解析/偏移/查找）提供，本组件只管排版。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    text?: string
    car?: boolean
  }>(),
  { text: '', car: false }
)

const lines = computed(() => (props.text ? props.text.split('\n') : []))
</script>

<template>
  <div v-if="lines.length" class="subo" :class="{ car }">
    <p v-for="(l, i) in lines" :key="i">{{ l }}</p>
  </div>
</template>

<style scoped>
.subo {
  position: absolute;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  max-width: 84%;
  text-align: center;
  pointer-events: none;
  z-index: 12;
}
.subo p {
  margin: 0;
  display: inline-block;
  padding: 3px 10px;
  font-size: 16px;
  line-height: 1.5;
  color: #fff;
  background: rgba(0, 0, 0, 0.62);
  border-radius: 6px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.subo.car p {
  font-size: 24px;
  bottom: auto;
}
</style>
