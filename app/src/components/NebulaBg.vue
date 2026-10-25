<script setup lang="ts">
/**
 * 星云背景视觉
 *
 * 品牌固定视觉：不随主题变化，深色星云基调恒定。
 * 审验四点（缺一返工）
 * ① 渐变：左上 #241a4d → 右下 #0d1030，方向 135°；
 * ② 星云粒子 40~60 颗（2~4px 圆点、透明度 0.15~0.4、漂移 20~40s 循环，canvas 不触发布局）；
 * ③ 音符装饰 3~5 个（♪ 旋律组合，半透明 0.2，极缓浮动）；
 * ④ 右侧「星河 STARWISH MUSIC」艺术字：竖排两行「星河」40px/700/0.5 +
 *    「STARWISH MUSIC」18px/letter-spacing 2px/0.35，位于视觉区右侧中部（横向 78%~91%、纵向 55%~80%）。
 * 桌面端宿主 = 首页主视觉欢迎区卡片；移动端宿主 = 首页整页（简化
 * 粒子 ~20 颗、禁用动画、艺术字等比 0.6、对比度 ≥4.5:1）。装饰层不响应交互。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
 /** 移动端简化 */
    compact?: boolean
  }>(),
  { compact: false }
)

const canvasEl = ref<HTMLCanvasElement | null>(null)
let raf = 0
type Dot = { x: number; y: number; r: number; vx: number; vy: number; a: number; phase: number }
let dots: Dot[] = []

/** 粒子分布：右侧星云辉光区最密，向左渐稀（对齐设计稿星点分布） */
function genDots(w: number, h: number, count: number): Dot[] {
  const out: Dot[] = []
  for (let i = 0; i < count; i++) {
    const roll = Math.random()
    let x: number
    let y: number
    if (roll < 0.5) {
      // 右侧辉光区（横向 72%~100%）
      x = w * (0.72 + Math.random() * 0.28)
      y = h * Math.random()
    } else if (roll < 0.85) {
      // 中部过渡带（35%~72%），沿对角渐稀
      x = w * (0.35 + Math.random() * 0.37)
      y = h * (0.1 + Math.random() * 0.85)
    } else {
      // 左侧极稀微尘
      x = w * (0.03 + Math.random() * 0.32)
      y = h * Math.random()
    }
    out.push({
      x,
      y,
      // 审验②：2~4px 直径
      r: 1 + Math.random() * 1,
      vx: (Math.random() - 0.5) * 0.03,
      vy: -(0.02 + Math.random() * 0.05),
      a: 0.15 + Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2,
    })
  }
  return out
}

function seed(): void {
  const c = canvasEl.value
  if (!c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.max(1, Math.round(c.clientWidth * dpr))
  c.height = Math.max(1, Math.round(c.clientHeight * dpr))
  const n = props.compact ? 20 : 48 + Math.floor(Math.random() * 12)
  dots = genDots(c.width, c.height, n).map(d => ({ ...d, r: d.r * dpr }))
}

function draw(t: number, animate: boolean): void {
  const c = canvasEl.value
  const ctx = c?.getContext('2d')
  if (!c || !ctx) return
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#e9e4ff'
  for (const d of dots) {
    if (animate) {
      d.x += d.vx
      d.y += d.vy
      if (d.y < -4) d.y = c.height + 4
      if (d.x < -4) d.x = c.width + 4
      if (d.x > c.width + 4) d.x = -4
    }
    ctx.globalAlpha = animate ? d.a * (0.75 + 0.25 * Math.sin(t / 2400 + d.phase)) : d.a
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function frame(t: number): void {
  draw(t, true)
  raf = requestAnimationFrame(frame)
}

function onResize(): void {
  seed()
  draw(0, false)
}

onMounted(() => {
  seed()
 //移动端静态粒子（禁漂移/闪烁省电）；桌面端缓慢漂移
  if (props.compact) draw(0, false)
  else raf = requestAnimationFrame(frame)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="nebula" :class="{ compact }" aria-hidden="true">
    <!-- 审验①：135° 基底渐变（左上 #241a4d → 右下 #0d1030） -->
    <div class="base" />
    <!-- 右侧星云辉光（设计稿视觉基因：紫色光晕核心） -->
    <div class="glow" />
    <div class="glow sm" />
    <!-- 审验②：星云粒子（canvas） -->
    <canvas ref="canvasEl" class="stars" />
    <!-- 审验③：音符装饰（主音符 + 3 枚半透明 0.2 小音符，极缓浮动） -->
    <span class="note-main">♪</span>
    <span class="note n1">♫</span>
    <span class="note n2">♩</span>
    <span class="note n3">♪</span>
    <!-- 审验④：右侧品牌艺术字（78%~91% × 55%~80%） -->
    <div class="brand-art">
      <b>星河</b>
      <span>STARWISH&nbsp;MUSIC</span>
    </div>
  </div>
</template>

<style scoped>
.nebula {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.base {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #241a4d 0%, #191539 46%, #0d1030 100%);
}
/* 右侧星云辉光：紫色光晕核心向左下渐隐（设计稿 #422f6a/#7d729c 视觉基因） */
.glow {
  position: absolute;
  right: -14%;
  top: -46%;
  width: 62%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 55% 62%, rgba(124, 90, 220, 0.5) 0%, rgba(96, 70, 190, 0.22) 44%, transparent 68%);
  filter: blur(10px);
}
.glow.sm {
  right: 2%;
  top: -8%;
  width: 30%;
  background: radial-gradient(circle at 50% 55%, rgba(158, 124, 255, 0.34) 0%, rgba(124, 90, 220, 0.14) 48%, transparent 70%);
}
.stars {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
/* 主音符：白色柔光（设计稿主视觉）；三枚小音符半透明 0.2（审验③） */
.note-main {
  position: absolute;
  right: 13.5%;
  top: 22%;
  font-size: 62px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.72);
  transform: rotate(-12deg);
  text-shadow:
    0 0 18px rgba(196, 181, 253, 0.6),
    0 0 46px rgba(139, 99, 235, 0.4);
  animation: note-float 26s ease-in-out infinite alternate;
}
.note {
  position: absolute;
  color: rgba(233, 228, 255, 0.2);
  font-size: 18px;
  line-height: 1;
  animation: note-float 32s ease-in-out infinite alternate;
}
.n1 { right: 30%; top: 14%; font-size: 20px; }
.n2 { right: 6.5%; top: 64%; font-size: 15px; animation-duration: 38s; }
.n3 { right: 40%; top: 58%; font-size: 14px; color: rgba(233, 228, 255, 0.14); animation-duration: 44s; }
@keyframes note-float {
  from { transform: translateY(0) rotate(-12deg); }
  to { transform: translateY(-8px) rotate(-8deg); }
}
/* 审验④：右侧品牌艺术字（横向 78%~91% = right 9% + 内容宽 ~13%；纵向 55%~80% = top 55%） */
.brand-art {
  position: absolute;
  right: 9%;
  top: 55%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
  user-select: none;
}
.brand-art b {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 10px;
  margin-right: -10px; /* 末字距视觉补偿，保证右缘对齐 */
  color: rgba(255, 255, 255, 0.5);
}
.brand-art span {
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}
/* 移动端：艺术字 0.6 倍、禁动画、粒子静态（canvas 侧） */
.compact .note-main {
  font-size: 38px;
  right: 12%;
  top: 17%;
  animation: none;
}
.compact .note {
  animation: none;
}
.compact .brand-art {
  transform: scale(0.6);
  transform-origin: right top;
  top: 55%;
  right: 5%;
}
.compact .glow {
  filter: blur(6px);
}
</style>
