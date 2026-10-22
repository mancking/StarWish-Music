<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/Icon.vue'
import { useUiStore } from '@/stores/ui'
import { call } from '@/api'

/**
 * 移动端 WebView 引擎检测与升级引导弹窗。
 *
 * 背景：v2.3.0 真机出现过「手势失灵 / 样式错乱」，根因是部分设备系统 WebView
 * （Chrome 内核）过旧——本项目手势（PointerEvent）、`100dvh`、`color-mix()`
 * 等能力都需要较新内核，旧内核下这些特性**静默失效**而不是报错。
 * 此前版本的修复方式就是引擎升级引导；这里把它沉淀为启动时的常驻自检：
 *  - 内核 < Chrome 100，或缺失 PointerEvent / dvh / color-mix → 弹窗说明；
 *  - 「前往升级」跳系统应用商店的 Android System WebView 详情页（市场协议优先）；
 *  - 用户选择「仍要使用」后本次安装不再打扰（localStorage 记忆，按内核版本失效）。
 */
const open = ref(false)
const uaVersion = ref('')
const router = useRouter()
const ui = useUiStore()

const KEY = 'sw.engineWarned'

function chromeVersion(): number {
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent || '')
  return m ? parseInt(m[1], 10) : 0
}

function missingFeatures(): string[] {
  const miss: string[] = []
  if (typeof (globalThis as any).PointerEvent === 'undefined') miss.push('触屏手势（PointerEvent）')
  try {
    if (!CSS.supports('height', '100dvh')) miss.push('全面屏适配（dvh）')
    if (!CSS.supports('color', 'color-mix(in srgb, red, blue)')) miss.push('动态配色（color-mix）')
  } catch { /* 极老内核连 CSS.supports 都缺，上面 UA 判定兜底 */ }
  return miss
}

function shouldWarn(): boolean {
  const v = chromeVersion()
  uaVersion.value = v ? String(v) : '未知'
  const bad = v > 0 && v < 100
  const miss = missingFeatures()
  if (!bad && !miss.length) return false
  try {
    if (localStorage.getItem(KEY) === `v${uaVersion.value}`) return false
  } catch { /* 无痕模式等，继续提示 */ }
  return true
}

function goUpgrade(): void {
  const id = 'com.google.android.webview'
  const candidates = [
    `market://details?id=${id}`,
    `https://play.google.com/store/apps/details?id=${id}`,
  ]
  void (async () => {
    for (const url of candidates) {
      try {
        await call('app:openExternal', { url })
        return
      } catch { /* 尝试下一个 */ }
    }
    // 全部失败（无商店/老内核无法唤起）：复制兜底链接
    try {
      await navigator.clipboard.writeText(candidates[1])
      ui.toast('商店链接已复制，请在浏览器打开升级「Android System WebView」', 'info', 5000)
    } catch {
      ui.toast('请在应用商店搜索「Android System WebView」升级后重启应用', 'info', 6000)
    }
  })()
}

function dismiss(): void {
  open.value = false
  try {
    localStorage.setItem(KEY, `v${uaVersion.value}`)
  } catch { /* ignore */ }
}

onMounted(() => {
  // 延迟到首帧后再弹，避免与启动渲染抢主线程
  setTimeout(() => {
    if (shouldWarn()) open.value = true
  }, 1200)
})
</script>

<template>
  <Modal v-model="open" title="需要更新系统组件" :width="340">
    <div class="eg-body">
      <p>
        当前设备的 WebView 内核版本较旧
        <b>（Chrome/{{ uaVersion }}）</b>，
        部分能力（手势、全面屏适配、动态配色）无法生效，可能表现为：
      </p>
      <ul>
        <li>滑动返回、下拉刷新等手势无响应</li>
        <li>界面配色或布局显示异常</li>
      </ul>
      <p>升级「Android System WebView」后重新打开星河音乐即可恢复。</p>
    </div>
    <template #footer>
      <button class="eg-btn ghost" @click="dismiss">仍要使用</button>
      <button class="eg-btn primary" @click="goUpgrade"><Icon name="download" :size="15" /> 前往升级</button>
    </template>
  </Modal>
</template>

<style scoped>
.eg-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}
.eg-body b {
  color: var(--text);
}
.eg-body ul {
  margin: 0;
  padding-left: 18px;
}
.eg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  border: 0;
  font-size: 14px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.eg-btn.primary {
  background: var(--accent);
  color: #fff;
}
.eg-btn.ghost {
  background: var(--bg-2);
  color: var(--text-2);
  border: 1px solid var(--line);
}
</style>
