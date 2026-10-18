/**
 * 移动端触屏下拉刷新（下拉持续 3 秒触发）。
 *
 * 手机没有 F5/刷新按钮：主滚动区（App 的 .content）在顶部时继续下拉超过
 * 阈值，顶部露出提示条；**按住不放持续 3 秒**后整页 reload，当前页所有
 * 数据（音源、榜单、推荐、播客）重新拉取。中途松手或推回则取消。
 *
 * ponytail: 整页 reload 而不是各页面各自实现 refresh —— 覆盖全部路由且不
 * 侵入任何组件；升级路径是各路由暴露 refresh() 做局部刷新，消除刷新白屏。
 */
const THRESHOLD = 60 // 下拉多少 px 后进入「按住计时」状态
const MAX = 110 // 提示条跟随位移上限
const HOLD_MS = 3000 // 持续按住多久触发刷新

export function installPullRefresh(): void {
  const hint = document.createElement('div')
  hint.className = 'pull-refresh-hint'
  hint.textContent = '下拉刷新'
  document.body.appendChild(hint)

  const content = (): HTMLElement | null => document.querySelector<HTMLElement>('.content')
  const atTop = (): boolean => {
    const el = content()
    return !el || el.scrollTop <= 0
  }

  let startX = 0
  let startY = 0
  let active = false // 已确认是「顶部下拉」手势，接管后续 touchmove
  let dist = 0
  let holdTimer: number | null = null // 按住计时器
  let tickTimer: number | null = null // 进度文案刷新
  let holdStart = 0
  let fired = false

  const clearTimers = (): void => {
    if (holdTimer !== null) clearTimeout(holdTimer)
    if (tickTimer !== null) clearInterval(tickTimer)
    holdTimer = null
    tickTimer = null
  }

  const show = (d: number): void => {
    dist = d
    hint.style.transition = 'none'
    hint.style.transform = `translateY(${Math.min(d, MAX) - 44}px)`
    const ready = d >= THRESHOLD
    hint.classList.toggle('ready', ready)
    if (!ready) hint.textContent = '下拉刷新'
    // 进入计时状态由 startHold 负责；这里只在计时未跑时更新文案
    if (ready && holdTimer === null && !fired) startHold()
    if (!ready && holdTimer !== null) stopHold('下拉刷新')
  }

  const stopHold = (text: string): void => {
    clearTimers()
    hint.textContent = text
  }

  const startHold = (): void => {
    holdStart = Date.now()
    hint.textContent = '按住 3 秒刷新…'
    holdTimer = window.setTimeout(() => {
      fired = true
      clearTimers()
      hint.style.transition = 'none'
      hint.style.transform = `translateY(${MAX - 44}px)`
      hint.classList.add('ready')
      hint.textContent = '正在刷新…'
      setTimeout(() => window.location.reload(), 200)
    }, HOLD_MS)
    tickTimer = window.setInterval(() => {
      const left = Math.max(0, HOLD_MS - (Date.now() - holdStart))
      hint.textContent = left > 0 ? `按住 ${Math.ceil(left / 1000)} 秒刷新…` : '正在刷新…'
    }, 200)
  }

  const hide = (): void => {
    dist = 0
    clearTimers()
    fired = false
    hint.style.transition = 'transform .18s'
    hint.style.transform = 'translateY(-100%)'
    hint.classList.remove('ready')
  }

  document.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1 || !atTop()) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      active = false
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
      if (e.cancelable) e.preventDefault() // 拦掉浏览器橡皮筋/继续滚动
    },
    { passive: false },
  )

  // 松手：未到 3 秒一律取消（含已达阈值但提前松手）
  const end = (): void => {
    if (!active || fired) return
    active = false
    hide()
  }
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
}
