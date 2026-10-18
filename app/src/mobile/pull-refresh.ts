/**
 * 移动端触屏下拉刷新。
 *
 * 手机没有 F5/刷新按钮：主滚动区（App 的 .content）在顶部时继续下拉超过
 * 阈值，顶部露出提示条；松手即整页 reload，当前页所有数据（音源、榜单、
 * 推荐、播客）重新拉取。
 *
 * ponytail: 整页 reload 而不是各页面各自实现 refresh —— 覆盖全部路由且不
 * 侵入任何组件；升级路径是各路由暴露 refresh() 做局部刷新，消除刷新白屏。
 */
const THRESHOLD = 70 // 下拉多少 px 后松手才触发
const MAX = 110 // 提示条跟随位移上限

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

  const show = (d: number): void => {
    dist = d
    hint.style.transition = 'none'
    hint.style.transform = `translateY(${Math.min(d, MAX) - 44}px)`
    const ready = d >= THRESHOLD
    hint.classList.toggle('ready', ready)
    hint.textContent = ready ? '松开刷新' : '下拉刷新'
  }
  const hide = (): void => {
    dist = 0
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

  const end = (): void => {
    if (!active) return
    active = false
    if (dist >= THRESHOLD) {
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
