<script setup lang="ts">
/**
 * SignedSourceDialog —— 未装签名源插件指引弹层（桌面/移动共用，规格书第 2 章 S2.3）
 *
 * 触发场景：
 *  · MV 页点击「需签名源插件」的卡片（open() 拦截）；
 *  · 播放页取流返回错误码 SIGNED_SOURCE_REQUIRED。
 * 内容：解释签名源是什么 → 列出需安装的插件 → 一键跳转「设置 → 音源与插件 → 签名源」。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ open: boolean; platform?: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const router = useRouter()

const PLATFORM_META: Record<string, { name: string; plugin: string }> = {
  kg: { name: '酷狗', plugin: '酷狗签名源' },
  kw: { name: '酷我', plugin: '酷我签名源' },
}

const platformName = computed(() => PLATFORM_META[props.platform || '']?.name || props.platform || '该平台')
const pluginName = computed(() => PLATFORM_META[props.platform || '']?.plugin || '对应签名源插件')

function close(): void {
  emit('update:open', false)
}

function goMarket(): void {
  close()
  // 路由 query 定位：设置页读取 marketTab 直接落到「签名源」市场分区
  void router.push({ path: '/settings', query: { cat: 'sources', marketTab: 'signed-source' } })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ssd-mask" @click.self="close">
      <div class="ssd-card" role="dialog" aria-modal="true" :aria-label="pluginName + ' 安装指引'">
        <header class="ssd-head">
          <b>需要签名源插件</b>
          <button class="txt" aria-label="关闭" @click="close"><Icon name="close" :size="16" /></button>
        </header>
        <div class="ssd-body">
          <p class="ssd-line">
            {{ platformName }}的音视频直链需要平台签名，星河内置源不持有签名能力。
          </p>
          <p class="ssd-line">
            安装官方签名源插件 <b>{{ pluginName }}</b> 后即可正常播放，插件市场提供在线安装与更新。
          </p>
          <ol class="ssd-steps">
            <li>打开「设置 → 音源与插件 → 插件市场」</li>
            <li>切换到「签名源」分区</li>
            <li>安装 <b>{{ pluginName }}</b>，安装完成后回到本页重新播放</li>
          </ol>
        </div>
        <footer class="ssd-foot">
          <button class="btn ghost" @click="close">暂不安装</button>
          <button class="btn primary" @click="goMarket">去安装签名源插件</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ssd-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ssd-card {
  width: min(440px, 94vw);
  background: var(--panel);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.ssd-head {
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
}
.ssd-head .txt {
  background: none;
  border: 0;
  color: var(--text-2);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
}
.ssd-head .txt:hover {
  background: var(--hover, rgba(127, 127, 127, 0.12));
}
.ssd-body {
  padding: 4px 16px 8px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text-main);
}
.ssd-line {
  margin: 4px 0;
}
.ssd-steps {
  margin: 10px 0 6px;
  padding-left: 20px;
  color: var(--text-2);
  font-size: 13px;
}
.ssd-foot {
  padding: 12px 16px 16px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.ssd-foot .btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  border: 0;
  cursor: pointer;
  font-size: 13.5px;
}
.ssd-foot .btn.ghost {
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--line, rgba(127, 127, 127, 0.25));
}
.ssd-foot .btn.primary {
  background: var(--accent);
  color: #fff;
}
@media (max-width: 560px) {
  .ssd-mask {
    padding: 0;
    align-items: flex-end;
  }
  .ssd-card {
    width: 100%;
    border-radius: 16px 16px 0 0;
  }
}
</style>
