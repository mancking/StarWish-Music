/**
 * 移动端弹层栈（规格书 Bug 39 模块化落地）
 * ----------------------------------------
 * 页面把「当前打开的浮层关闭器」按打开顺序压栈；系统返回键（back-handler）
 * 先 closeTopPopup() 关最上层浮层，栈空才逐级回路由。
 *
 * closer 约定：执行关闭动作并返回 true 表示确实关掉了东西； false 表示无事发生。
 */
type Closer = () => boolean

const stack: Closer[] = []

/** 注册浮层关闭器（页面 onMounted 时调用；返回注销函数，onUnmounted 时执行） */
export function registerPopupCloser(close: Closer): () => void {
  stack.push(close)
  return () => {
    const i = stack.indexOf(close)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** 关闭最上层浮层；返回是否有关闭动作发生 */
export function closeTopPopup(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true
    } catch {
      /* closer 内部异常视作未关闭，继续向栈底找 */
    }
  }
  return false
}

export function popupDepth(): number {
  return stack.length
}
