/**
 * 移动端全局手势：左右边缘向内滑动返回上一层（v1.0.0 重写）。
 *
 * 用户口径（本轮需求）：「左右边缘向内滑动：返回上一层」。
 * 旧实现只认左缘右滑，右缘无手势；且被 main.mobile.ts 与 App.vue 各装一次
 * （无幂等守卫），一次滑动会触发两次 handleBack 连退两层 —— 本次一并修复。
 *
 * 设计要点：
 *  - 双侧边缘：左缘右滑（dir=+1）与右缘左滑（dir=-1）统一归一化为向内位移
 *  - Pointer Events：项目内 Slider/ControlBar/ProgressBar 的既有范式（可捕获指针，
 *    不与 passive touch 监听竞争），仅 pan-y 场景可靠；纵向滚动意图即放弃
 *  - 跟手视觉：边缘出现高亮指示条随位移变长变亮（GPU transform，不触发布局）
 *  - 排除区：交互元素 + 横向滚动容器（.m-car 横滑卡片流等），避免误伤
 *  - 触发后汇入 handleBack 统一返回（关弹层 → 退子页 → 逐级回路由）
 */
import { handleBack } from './back-handler'
import type { Router } from 'vue-router'

/** 起手热区宽度（px）：既覆盖用户肌肉记忆，又不过分抢占页面点击 */
const EDGE = 30
/** 触发位移阈值（px） */
const DIST = 72

let installed = false

export function installEdgeBack(router: Router): void {
  // 幂等守卫：修复旧版 main.mobile.ts + App.vue 双重安装导致一次滑动退两层
  if (installed) return
  installed = true

  let startX = 0
  let startY = 0
  let tracking = false
  let done = false
  /** +1 = 左缘右滑；-1 = 右缘左滑 */
  let dir = 1

  // 跟手指示条（贴起始缘）
  const bar = document.createElement('div')
  bar.className = 'sw-back-bar'
  document.body.appendChild(bar)

  const placeBar = (side: 'left' | 'right'): void => {
    bar.classList.toggle('from-right', side === 'right')
  }
  const setBar = (h: number, opacity: number): void => {
    bar.style.height = `${h}px`
    bar.style.opacity = String(opacity)
  }

  /** 命中交互元素或横向滚动容器时不抢手势 */
  const blocked = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    if (!el || !el.closest) return true
    if (el.closest('button, input, textarea, a, .slider, [data-no-edge-back]')) return true
    // 横滑容器（首页卡片流 / 发现 chips / 榜单 tab）：内部可横向滚时让位
    const sc = el.closest('.m-car, .d-chips, .d-cats, .mv-src-tabs, [data-scroll-x]') as HTMLElement | null
    if (sc && sc.scrollWidth > sc.clientWidth + 2) return true
    return false
  }

  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (blocked(e.target)) return
      const w = window.innerWidth
      const fromLeft = e.clientX <= EDGE
      const fromRight = e.clientX >= w - EDGE
      if (!fromLeft && !fromRight) return
      tracking = true
      done = false
      dir = fromLeft ? 1 : -1
      startX = e.clientX
      startY = e.clientY
      placeBar(fromLeft ? 'left' : 'right')
      setBar(0, 0)
    },
    { passive: true },
  )

  document.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (!tracking || done) return
      // 位移按方向归一化：向内为正
      const dx = (e.clientX - startX) * dir
      const dy = e.clientY - startY
      if (dx <= 4 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        // 纵向意图 / 反向滑动：放弃
        setBar(0, 0)
        return
      }
      // 跟手高亮：位移越大条越长越亮
      const p = Math.min(1, dx / DIST)
      setBar(56 + p * 96, 0.35 + p * 0.55)
      if (dx > DIST) {
        done = true
        tracking = false
        setBar(0, 0)
        handleBack(router)
      }
    },
    { passive: true },
  )

  const end = (): void => {
    tracking = false
    setBar(0, 0)
  }
  document.addEventListener('pointerup', end, { passive: true })
  document.addEventListener('pointercancel', end, { passive: true })
}
