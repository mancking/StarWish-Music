<script setup lang="ts">
/**
 * 播放页背景（规格书 4.7 播放页背景体系 / Bug 21/22 · 公共组件）
 *
 * 四态（设置 playerBg）：cover 封面模糊 / gradient 动态渐变 / wallpaper 壁纸 / solid 纯色。
 * 桌面 Player.vue / 移动 mobile/Player.vue / 车机 CarPlayer.vue 三端复用，渲染行为一致。
 * - gradient：封面取色（Canvas getImageData 主频色）→ linear-gradient(提取色→#121212)，300ms 过渡
 * - wallpaper：壁纸库图片，消费 模糊/遮罩/亮度/缩放/轮换 参数（wallpaper*）
 * - solid：默认 #121212（Spotify 兜底色），渐变取色失败/低饱和封面的 fallback
 * 车机降级：仅 gradient + solid，不显示封面模糊（4.7 车机降级）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import { platform, tierFor } from '@/platform'
import type { PlatformKind } from '@/platform'

const props = withDefaults(
  defineProps<{
    /** 当前封面 URL（xinyuan:// 或 https），空时占位渐变 */
    cover: string
    /** 车机降级：无模糊、无壁纸，仅渐变/纯色 */
    kind?: PlatformKind
  }>(),
  { cover: '', kind: undefined }
)

const ui = useUiStore()
const settings = ui.settings as Record<string, any>
const mode = computed(() => String(settings.playerBg || 'cover'))
const kind = computed<PlatformKind>(() => props.kind || platform.value.kind)

/* ---------------- 模糊半径按性能档（0.3 规则） ---------------- */
const blurPx = computed(() => {
  if (mode.value !== 'cover') return 0
  const tier = tierFor(kind.value)
  if (kind.value === 'car') return 0
  return tier.blur || (kind.value === 'phone' ? 8 : 12)
})

/* ---------------- 动态渐变：封面取色（Spotify pipeline） ---------------- */
const domColor = ref('#5b4a8a')
let colorCache = new Map<string, string>()
let lastThumb = ''

async function extractColor(src: string): Promise<void> {
  if (!src) return
  const cached = colorCache.get(src)
  if (cached) {
    domColor.value = cached
    return
  }
  // 用小尺寸绘制降低 getImageData 成本（限长边 32px）
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const srcUrl = src.startsWith('xinyuan:') || src.startsWith('swmedia://') ? src : src
    img.src = srcUrl
    if (!img.complete) await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('封面加载失败'))
      window.setTimeout(() => reject(new Error('封面加载超时')), 4000)
    })
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 24, 24)
    const { data } = ctx.getImageData(0, 0, 24, 24)
    // rgba 分桶统计频次（量化到 32 级），取最高频桶均值
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = data[i + 3]!
      if (a < 128) continue
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
      cur.r += r
      cur.g += g
      cur.b += b
      cur.n++
      buckets.set(key, cur)
    }
    let best = { r: 91, g: 74, b: 138, n: 0 }
    for (const v of buckets.values()) if (v.n > best.n) best = v
    const hex = `#${[best.r, best.g, best.b].map(x => Math.round(x / Math.max(1, best.n)).toString(16).padStart(2, '0')).join('')}`
    domColor.value = hex
    if (colorCache.size > 40) colorCache = new Map()
    colorCache.set(src, hex)
  } catch {
    /* 取色失败走兜底色（4.7 solid 语义） */
  }
}

watch(
  () => props.cover,
  c => {
    if (mode.value === 'gradient' && c && c !== lastThumb) {
      lastThumb = c
      void extractColor(c)
    }
  },
  { immediate: true }
)
watch(mode, m => {
  if (m === 'gradient' && props.cover) void extractColor(props.cover)
})

/* ---------------- 壁纸库（4.7 ③：统一走壁纸库 wallpaperId + 轮换） ---------------- */
const wallList = ref<{ id: string; name: string; file: string }[]>([])
const wallIdx = ref(0)
let rotateTimer = 0

const wallEnabled = computed(() => mode.value === 'wallpaper' && settings.wallpaperEnabled !== false)
const wallUrl = computed(() => {
  const item = wallList.value[wallIdx.value % Math.max(1, wallList.value.length)]
  return item?.file || ''
})

function armRotation(): void {
  window.clearInterval(rotateTimer)
  rotateTimer = 0
  const rot = String(settings.wallpaperRotation || 'off')
  const interval = Math.max(1, Number(settings.wallpaperIntervalMin) || 10) * 60_000
  if (rot === 'timer' && wallList.value.length > 1) {
    rotateTimer = window.setInterval(() => {
      wallIdx.value = (wallIdx.value + 1) % wallList.value.length
    }, interval)
  } else if (rot === 'random' && wallList.value.length > 1) {
    rotateTimer = window.setInterval(() => {
      if (wallList.value.length < 2) return
      wallIdx.value = Math.floor(Math.random() * wallList.value.length)
    }, interval)
  } else if (rot === 'song') {
    // 随歌曲轮换：外部 watch cover 变化推进
  }
}

watch(
  () => props.cover,
  () => {
    if (String(settings.wallpaperRotation) === 'song' && wallList.value.length > 1) {
      wallIdx.value = (wallIdx.value + 1) % wallList.value.length
    }
  }
)

watch(
  wallEnabled,
  async on => {
    if (!on) return
    if (!wallList.value.length) {
      try {
        const r = await call<any[]>('wallpaper:list')
        wallList.value = (r || []).map((x: any) => ({ id: String(x.id), name: String(x.name || ''), file: String(x.url || x.file || '') }))
      } catch {
        wallList.value = []
      }
    }
    armRotation()
  },
  { immediate: true }
)
onBeforeUnmount(() => window.clearInterval(rotateTimer))

/* ---------------- 渲染层 ---------------- */
const coverBg = computed(() => (props.cover ? `url("${props.cover}")` : ''))
const solidColor = computed(() => String(settings.playerSolidColor || '#121212'))
const gradientCss = computed(() => `linear-gradient(180deg, ${domColor.value}, #121212)`)

const baseStyle = computed(() => {
  if (mode.value === 'solid') return { background: solidColor.value }
  if (mode.value === 'gradient') return { background: gradientCss.value }
  return { background: coverBg.value, backgroundSize: 'cover', backgroundPosition: 'center' }
})

const wallpaperStyle = computed(() => {
  if (!wallEnabled.value || !wallUrl.value) return null
  const blur = Number(settings.wallpaperBlur ?? 0)
  const bright = Number(settings.wallpaperBrightness ?? 100) / 100
  const scale = Number(settings.wallpaperScale ?? 100) / 100
  return {
    backgroundImage: `url("${wallUrl.value}")`,
    filter: `blur(${blur}px) brightness(${bright})`,
    transform: `scale(${Math.max(1.02, scale)})`,
    opacity: 1 - Number(settings.wallpaperMask ?? 0) / 100,
  }
})
</script>

<template>
  <div class="pbg">
    <div class="pbg-base" :style="baseStyle" />
    <div v-if="wallpaperStyle" class="pbg-wallpaper" :style="wallpaperStyle" />
    <div v-if="mode === 'cover'" class="pbg-dim" />
  </div>
</template>

<style scoped>
.pbg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
.pbg-base {
  position: absolute;
  inset: -40px;
  background-repeat: no-repeat;
  transition: background 300ms ease;
  will-change: background;
}
.pbg-wallpaper {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: opacity 300ms ease;
}
.pbg-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}
</style>
