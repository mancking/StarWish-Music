<script setup lang="ts">
/**
 * 播放页背景
 *
 * 模式集合（settings.value.playerBg）：
 *  - cover     封面魔法色渐变两层：提取主色 → 干预 → 2 个相关色 → 对角 135° 渐变，2s 过渡
 *  - lyric-wall 歌词墙：当前行 + 下一行超大字（LyricsWall.vue）
 *  - particle  粒子（复用 ParticleField.vue，档位 0.3）
 *  - spectrum  舞台频谱（复用 SpectrumBars.vue 全屏变体：柱高倍率 2.0、blur(8px) 尾光）
 *  - gradient  纯渐变（低性能降级：主色 → #121212）
 *  - solid     纯色兜底 #121212
 * 车机仅 cover（呈现为静态渐变）/gradient/solid，禁粒子、频谱、模糊（4.7 车机降级）。
 * 旧 wallpaper 已归并移除（存量值在设置层映射为 cover）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import { platform, particleCount, tierFor } from '@/platform'
import type { PlatformKind } from '@/platform'
import ParticleField from '@/components/player/ParticleField.vue'
import SpectrumBars from '@/components/player/SpectrumBars.vue'
import LyricsWall from './LyricsWall.vue'
import type { LyricViewLine } from '@/player-music/lyrics'

const props = withDefaults(
  defineProps<{
    cover: string
    /** lyric-wall 数据：歌词行与当前行下标 */
    lines?: LyricViewLine[]
    activeIndex?: number
    kind?: PlatformKind
  }>(),
  { cover: '', lines: () => [], activeIndex: -1, kind: undefined }
)

const ui = useUiStore()
// 响应式读取：ui.patch 会整体替换 settings.value，捕获旧对象会读到陈旧配置
const settings = computed(() => ui.settings as unknown as Record<string, any>)
const kind = computed<PlatformKind>(() => props.kind || platform.value.kind)
const car = computed(() => kind.value === 'car')

const BG_ORDER = ['cover', 'lyric-wall', 'particle', 'spectrum', 'gradient', 'wallpaper', 'solid'] as const
type BgMode = (typeof BG_ORDER)[number]
/** 存量 wallpaper → cover（迁移兜底） */
const mode = computed<BgMode>(() => {
  const v = String(settings.value.playerBg || 'cover')
  return (BG_ORDER as readonly string[]).includes(v) ? (v as BgMode) : 'cover'
})
/** 车机降级：粒子/频谱/歌词墙 → 静态渐变 */
const effMode = computed<BgMode>(() => {
  if (!car.value) return mode.value
  return mode.value === 'solid' ? 'solid' : 'gradient'
})

/**
 * 壁纸渲染参数（4.7 壁纸库 8 项中的渲染 4 项）
 *
 * 量纲以 shared/types.ts 为准：brightness 0.5~1.3、mask 0~0.8、
 * scale 1.0~1.5，都是「已归一的小数」，不能再除 100。
 * 旧实现按 0~100 解释，导致默认值 1 被当成 1% 亮度 → 壁纸几乎全黑，
 * 且 scale 被钳到 1.02 永远失效、遮罩 0.25 变 0.25% 等于没有。
 */
const wallpaperStyle = computed(() => {
  if (effMode.value !== 'wallpaper' || !wallUrl.value) return null
  const blur = Math.min(40, Math.max(0, Number(settings.value.wallpaperBlur ?? 0)))
  const bright = Math.min(1.3, Math.max(0.5, Number(settings.value.wallpaperBrightness ?? 1)))
  const scale = Math.min(1.5, Math.max(1, Number(settings.value.wallpaperScale ?? 1.06)))
  const mask = Math.min(0.8, Math.max(0, Number(settings.value.wallpaperMask ?? 0.25)))
  return {
    backgroundImage: `url("${wallUrl.value}")`,
    filter: `blur(${blur}px) brightness(${bright})`,
    transform: `scale(${scale})`,
    // 遮罩浓度 → 不透明度：浓度越高，壁纸越淡（文字越清晰）
    opacity: 1 - mask,
  }
})

/* ---------------- 封面魔法色渐变（主色 → 2 相关色 → 135°） ---------------- */
const c1 = ref('#5b4a8a')
const c2 = ref('#2a1f4d')
let colorCache = new Map<string, [string, string]>()
let lastThumb = ''

function relatedColors(r: number, g: number, b: number): [string, string] {
  const hsl = rgbToHsl(r, g, b)
  // 主色干预：饱和度抬到 0.35~0.6、亮度压到 0.22~0.42（深色音乐氛围，禁止高饱和大色块）
  const s = Math.min(0.6, Math.max(0.35, hsl[1]))
  const l = Math.min(0.42, Math.max(0.22, hsl[2]))
  const a = hslToHex(hsl[0], s, l)
  // 相关色：色相 ±18°，亮度更低一层
  const b2 = hslToHex(hsl[0] + 18 / 360, s * 0.9, Math.max(0.14, l - 0.12))
  return [a, b2]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(v * 255)
  }
  return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

async function extractColors(src: string): Promise<void> {
  if (!src) return
  const cached = colorCache.get(src)
  if (cached) {
    ;[c1.value, c2.value] = cached
    return
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    if (!img.complete) {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('封面加载失败'))
        window.setTimeout(() => reject(new Error('封面加载超时')), 4000)
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 24, 24)
    const { data } = ctx.getImageData(0, 0, 24, 24)
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!
      if (a < 128) continue
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
      cur.r += r; cur.g += g; cur.b += b; cur.n++
      buckets.set(key, cur)
    }
    let best = { r: 91, g: 74, b: 138, n: 0 }
    for (const v of buckets.values()) if (v.n > best.n) best = v
    const pair = relatedColors(Math.round(best.r / Math.max(1, best.n)), Math.round(best.g / Math.max(1, best.n)), Math.round(best.b / Math.max(1, best.n)))
    c1.value = pair[0]
    c2.value = pair[1]
    if (colorCache.size > 40) colorCache = new Map()
    colorCache.set(src, pair)
  } catch {
    /* 取色失败保持上一组色（solid 语义兜底） */
  }
}

watch(
  () => [props.cover, mode.value] as const,
  ([c]) => {
    if ((mode.value === 'cover' || mode.value === 'gradient') && c && c !== lastThumb) {
      lastThumb = c
      void extractColors(c)
    }
  },
  { immediate: true }
)

const gradientCss = computed(() => `linear-gradient(135deg, ${c1.value} 0%, ${c2.value} 68%, #0b0b10 100%)`)

/* ---------------- 壁纸子项（4.7+ ②：本地壁纸库轮换参数） ---------------- */
const wallList = ref<{ id: string; name: string; file: string }[]>([])
const wallIdx = ref(0)
let rotateTimer = 0

const wallUrl = computed(() => {
  const item = wallList.value[wallIdx.value % Math.max(1, wallList.value.length)]
  return item?.file || ''
})

function armRotation(): void {
  window.clearInterval(rotateTimer)
  rotateTimer = 0
  const rot = String(settings.value.wallpaperRotation || 'off')
  const interval = Math.max(1, Number(settings.value.wallpaperIntervalMin) || 10) * 60_000
  if (rot === 'timer' && wallList.value.length > 1) {
    rotateTimer = window.setInterval(() => {
      wallIdx.value = (wallIdx.value + 1) % wallList.value.length
    }, interval)
  } else if (rot === 'random' && wallList.value.length > 1) {
    rotateTimer = window.setInterval(() => {
      wallIdx.value = Math.floor(Math.random() * wallList.value.length)
    }, interval)
  }
}

watch(
  () => [props.cover, mode.value] as const,
  ([c]) => {
    if (mode.value === 'wallpaper' && String(settings.value.wallpaperRotation) === 'song' && wallList.value.length > 1) {
      wallIdx.value = (wallIdx.value + 1) % wallList.value.length
    }
    if ((mode.value === 'cover' || mode.value === 'gradient') && c && c !== lastThumb) {
      lastThumb = c
      void extractColors(c)
    }
  },
  { immediate: true }
)

watch(
  () => mode.value,
  async m => {
    if (m === 'wallpaper' && !wallList.value.length) {
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

/* ---------------- 歌词墙数据 ---------------- */
const wallCur = computed(() => {
  const l = props.lines[props.activeIndex]
  return l?.text || ''
})
const wallNext = computed(() => {
  const l = props.lines[props.activeIndex + 1]
  return l?.text || ''
})

/* ---------------- 粒子/频谱档位（0.3） ---------------- */
const particles = computed(() => particleCount())
const particleOn = computed(() => effMode.value === 'particle' && settings.value.particle !== false)

onBeforeUnmount(() => {
  colorCache.clear()
  window.clearInterval(rotateTimer)
})
</script>

<template>
  <div class="pbg">
    <!-- cover / gradient / solid：底色层 -->
    <div v-if="effMode === 'solid'" class="pbg-base solid" />
    <div v-else class="pbg-base" :style="{ background: gradientCss }" />

    <!-- lyric-wall：歌词墙层 -->
    <LyricsWall v-if="effMode === 'lyric-wall'" class="pbg-wall" :current="wallCur" :next="wallNext" />

    <!-- wallpaper：壁纸子项（4.7+ ②，本地壁纸库轮换参数） -->
    <div v-if="wallpaperStyle" class="pbg-wallpaper" :style="wallpaperStyle" />

    <!-- particle：粒子层（z 0，内容之下） -->
    <ParticleField v-if="particleOn" class="pbg-fx" :count="particles" :enabled="true" />

    <!-- spectrum：舞台频谱全屏变体（柱高倍率 2.0 + 尾光） -->
    <div v-if="effMode === 'spectrum'" class="pbg-spec">
      <SpectrumBars placement="bottom" />
    </div>

        <!-- 压暗层：封面/歌词墙/粒子/频谱/壁纸模式下保证前景可读 -->
    <div v-if="effMode !== 'solid'" class="pbg-dim" :class="{ deep: effMode === 'cover' }" />
  </div>
</template>

<style scoped>
.pbg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
  background: #0b0b10;
}
.pbg-base {
  position: absolute;
  inset: -40px;
  background-repeat: no-repeat;
  /* 封面魔法色渐变 2s 过渡（3.14） */
  transition: background 2s ease;
  will-change: background;
}
.pbg-base.solid {
  background: #121212;
}
.pbg-wallpaper {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: opacity 300ms ease;
}
.pbg-wall,
.pbg-fx,
.pbg-spec {
  position: absolute;
  inset: 0;
}
.pbg-dim {
  position: absolute;
  inset: 0;
  background: rgba(11, 11, 16, 0.35);
}
.pbg-dim.deep {
  background: rgba(11, 11, 16, 0.5);
}
.pbg-spec {
  filter: blur(8px);
  opacity: 0.9;
}
</style>
