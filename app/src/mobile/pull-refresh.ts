import { subscribe } from './bus'

/**
 * 移动端触屏下拉刷新（顶部继续下拉超过阈值、松手刷新）。
 *
 * v1.0.0 修订——旧实现的两处硬伤
 *  1. **不保留当前页面**：松手直接 `window.location.reload()`，整页重载后
 *     路由回到初始页，用户从「我的/视频/发现」下拉刷新都会被扔回首页。
 *  2. **闪烁**：reload 产生白屏重启动画，且 hint 常驻导致位置跳动。
 *
 * 现在改为「事件驱动 + 页面自行刷新」：松手后广播 `app:pull-refresh`，
 * 各页面订阅后重拉自己的数据（保留路由、滚动与组件状态），
 * 拉完调用 `refreshDone()` 收起提示条；无人响应时 2.5s 自动收起，绝不 reload。
 */

const THRESHOLD = 64
const MAX = 110
/** 页面没响应时的兜底收起时间 */
const STUCK_MS = 2500

let hint: HTMLDivElement | null = null
let active = false
let ready = false
let fired = false
let busy = false
let stuckTimer = 0

function ensureHint(): HTMLDivElement {
  if (hint) return hint
  const el = document.createElement('div')
  el.className = 'pull-refresh-hint'
  el.textContent = '下拉刷新'
  document.body.appendChild(el)
  hint = el
  return el
}

function show(d: number): void {
  const el = ensureHint()
  el.style.transition = 'none'
  el.style.transform = `translateY(${Math.min(d, MAX) - 44}px)`
  ready = d >= THRESHOLD
  el.classList.toggle('ready', ready)
  el.textContent = ready ? '松手刷新' : '下拉刷新'
}

function hide(): void {
  const el = ensureHint()
  ready = false
  busy = false
  fired = false
  el.style.transition = 'transform .18s'
  el.style.transform = 'translateY(-100%)'
  el.classList.remove('ready')
  if (stuckTimer) {
    window.clearTimeout(stuckTimer)
    stuckTimer = 0
  }
}

function begin(): void {
  const el = ensureHint()
  el.style.transition = 'none'
  el.style.transform = `translateY(${MAX - 44}px)`
  el.classList.add('ready')
  el.textContent = '正在刷新…'
  // 兜底：没有页面认领这次刷新时，2.5s 后自动收起，避免提示条卡住
  if (stuckTimer) window.clearTimeout(stuckTimer)
  stuckTimer = window.setTimeout(hide, STUCK_MS)
}

const content = (): HTMLElement | null => document.querySelector<HTMLElement>('.m-content, .content')
const atTop = (): boolean => {
  const el = content()
  return !el || el.scrollTop <= 0
}

export function installPullRefresh(): void {
  let startX = 0
  let startY = 0

  document.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1 || !atTop()) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      active = false
      ready = false
      fired = false
    },
    { passive: true },
  )

  document.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length !== 1) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!active) {
        // 只认明显向下（且非横向滑动）的手势，避免误伤横向 tab/列表滑动
        if (dy < 10 || Math.abs(dy) < Math.abs(dx) * 1.5) return
        if (!atTop()) return
        active = true
      }
      if (dy <= 0) {
        hide()
        return
      }
      if (!atTop()) {
        active = false
        hide()
        return
      }
      show(dy)
      if (e.cancelable) e.preventDefault()
    },
    { passive: false },
  )

  const end = (): void => {
    if (!active || fired) return
    active = false
    if (ready) {
      fired = true
      busy = true
      begin()
      // 通知当前页自行刷新（保留路由与状态），不再整页 reload
      import('./bus').then(m => m.emit('app:pull-refresh', { at: Date.now() }))
    } else {
      hide()
    }
  }
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
}

/** 页面刷新完成时调用：收起提示条 */
export function refreshDone(): void {
  if (busy || (hint && hint.textContent === '正在刷新…')) hide()
}

/** 页面订阅下拉刷新（返回取消订阅函数） */
export function onPullRefresh(cb: () => void | Promise<void>): () => void {
  return subscribe('app:pull-refresh', () => {
    void cb()
  })
}
