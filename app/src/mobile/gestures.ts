/**
 * 移动端全局手势：左缘右滑返回。
 *
 * Android 用户的肌肉记忆是「边缘右滑 = 返回」（系统返回手势同向），桌面移植壳
 * 一直缺这一层，子页面只能靠顶栏返回键。这里在 document 上统一接管：
 *  - 起点在左缘 28px 内、横向位移 >72px 且明显大于纵向 → 触发统一返回处理
 *  - 跟手视觉：左缘出现一条高亮竖条，随手指下移/淡出
 *  - 排除 button/input/a/.slider 等交互元素，避免误伤横滑组件与滑杆
 *  - v2.3.2：返回行为汇入 handleBack（关弹层 → 回退 → 根页双击退后台），
 *    修复「根页边缘右滑直接退出应用」
 */
import { handleBack } from './back-handler'
import type { Router } from 'vue-router'

const EDGE = 28
const DIST = 72

export function installEdgeBack(router: Router): void {
  let startX = 0
  let startY = 0
  let tracking = false
  let done = false

  // 跟手指示条
  const bar = document.createElement('div')
  bar.className = 'sw-back-bar'
  document.body.appendChild(bar)

  const setBar = (h: number, opacity: number): void => {
    bar.style.height = `${h}px`
    bar.style.opacity = String(opacity)
  }

  document.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const el = e.target as HTMLElement | null
      if (el && el.closest('button, input, textarea, a, .slider, [data-no-edge-back]')) return
      tracking = t.clientX <= EDGE
      if (tracking) {
        startX = t.clientX
        startY = t.clientY
        done = false
        setBar(0, 0)
      }
    },
    { passive: true },
  )

  document.addEventListener(
    'touchmove',
    e => {
      if (!tracking || done) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (dx <= 4 || Math.abs(dx) < Math.abs(dy) * 1.2) {
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
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
}
