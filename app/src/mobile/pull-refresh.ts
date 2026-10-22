/**
 * 移动端触屏下拉刷新（下拉超过阈值后松手即刷新）。
 *
 * 手机没有 F5/刷新按钮：主滚动区（App 的 .m-content，桌面冒烟是 .content）
 * 在顶部时继续下拉超过阈值，顶部露出提示条，**松手立即整页 reload**，
 * 当前页所有数据（音源、榜单、推荐、播客）重新拉取。
 *
 * v2.3.1 修复：v2.3.0 绑定的是桌面滚动容器 `.content`，移动端外壳是
 * `.m-content`——真机上手势完全无响应；且旧版要求按住 3 秒才触发，
 * 体感「刷新时间过长」。现在两处一起修掉。
 */
const THRESHOLD = 64 // 下拉多少 px 后松手即刷新
const MAX = 110 // 提示条跟随位移上限

export function installPullRefresh(): void {
  const hint = document.createElement('div')
  hint.className = 'pull-refresh-hint'
  hint.textContent = '下拉刷新'
  document.body.appendChild(hint)

  const content = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.m-content, .content')
  const atTop = (): boolean => {
    const el = content()
    return !el || el.scrollTop <= 0
  }

  let startX = 0
  let startY = 0
  let active = false // 已确认是「顶部下拉」手势，接管后续 touchmove
  let ready = false // 位移已达阈值，松手即刷新
  let fired = false

  const show = (d: number): void => {
    hint.style.transition = 'none'
    hint.style.transform = `translateY(${Math.min(d, MAX) - 44}px)`
    ready = d >= THRESHOLD
    hint.classList.toggle('ready', ready)
    hint.textContent = ready ? '松手刷新' : '下拉刷新'
  }

  const hide = (): void => {
    ready = false
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
      if (e.cancelable) e.preventDefault() // 拦掉浏览器橡皮筋/继续滚动
    },
    { passive: false },
  )

  // 松手：已达阈值立即刷新，否则取消
  const end = (): void => {
    if (!active || fired) return
    active = false
    if (ready) {
      fired = true
      hint.style.transition = 'none'
      hint.style.transform = `translateY(${MAX - 44}px)`
      hint.classList.add('ready')
      hint.textContent = '正在刷新…'
      setTimeout(() => window.location.reload(), 200)
    } else {
      hide()
    }
  }
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
}
