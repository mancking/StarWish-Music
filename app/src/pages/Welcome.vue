<script setup lang="ts">
/**
 * 首次启动引导（规格书 0.9.3 / F-21 · 独立页面）
 *
 * DB 标记 onboarded=false → 首启进 /welcome（3 屏）：
 *  ① 应用已内置 X 个音源  ② 音源失效可从源市场一键安装  ③ 扫描本地音乐
 * 完成后写 onboarded=true 并回首页。无源时框架内容（本地/设置/下载）不受影响。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import brandIcon from '@/assets/brand-icon.png'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const ui = useUiStore()

const step = ref(0)
const sourceCount = ref(0)
const enabledCount = ref(0)

const steps = computed(() => [
  {
    icon: 'sparkles',
    title: '欢迎使用星河音乐',
    desc: `应用已内置 ${sourceCount.value} 个音源（当前启用 ${enabledCount.value} 个），开箱即可听歌。`,
  },
  {
    icon: 'download',
    title: '音源失效怎么办',
    desc: '音源全部失效时，可从「设置 → 源市场」一键安装插件与音源，也支持订阅源与本地 JS 导入。',
  },
  {
    icon: 'folder',
    title: '扫描本地音乐',
    desc: '在「本地音乐」页添加文件夹即可扫描入库，支持 MP3 / FLAC / M4A / OGG / WAV 等格式。',
  },
])

async function finish(): Promise<void> {
  try {
    await call('settings:set', { onboarded: true })
  } catch {
    /* ignore */
  }
  ui.toast('开始体验星河音乐', 'success', 1400)
  void router.replace('/')
}

onMounted(async () => {
  try {
    const list = await call<any[]>('sources:list')
    sourceCount.value = (list || []).length
    enabledCount.value = (list || []).filter((x: any) => x.enabled && !x.loadError).length
  } catch {
    sourceCount.value = 0
  }
})
</script>

<template>
  <div class="welcome-page">
    <img class="logo" :src="brandIcon" alt="" draggable="false" />
    <div class="dots">
      <i v-for="(s, i) in steps" :key="i" :class="{ on: step === i }" />
    </div>
    <section class="card">
      <Icon :name="steps[step]!.icon" :size="34" class="wicon" />
      <h1>{{ steps[step]!.title }}</h1>
      <p>{{ steps[step]!.desc }}</p>
    </section>
    <div class="acts">
      <button v-if="step > 0" class="btn" @click="step--">上一步</button>
      <button v-if="step < steps.length - 1" class="btn primary" @click="step++">下一步</button>
      <button v-else class="btn primary" @click="finish">开始使用</button>
      <button class="skip" @click="finish">跳过引导</button>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 40px 20px;
  background: radial-gradient(circle at 50% 20%, #1b1233, #0b0b10 70%);
}
.logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  box-shadow: 0 16px 40px -18px #000;
}
.dots {
  display: flex;
  gap: 8px;
}
.dots i {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.18);
  transition: all 0.2s;
}
.dots i.on {
  width: 22px;
  background: var(--accent, #a78bfa);
}
.card {
  max-width: 480px;
  min-height: 190px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 28px 30px;
  border-radius: 18px;
  background: var(--panel, #13131b);
  border: 1px solid var(--line, #262633);
}
.wicon {
  color: var(--accent, #a78bfa);
}
.card h1 {
  font-size: 21px;
  font-weight: 600;
}
.card p {
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--text-3, #9b9ba8);
}
.acts {
  display: flex;
  align-items: center;
  gap: 10px;
}
.skip {
  border: 0;
  background: transparent;
  color: var(--text-3, #9b9ba8);
  font-size: 12.5px;
  cursor: pointer;
  margin-left: 8px;
}
.skip:hover {
  color: var(--text, #ececf1);
}
</style>
