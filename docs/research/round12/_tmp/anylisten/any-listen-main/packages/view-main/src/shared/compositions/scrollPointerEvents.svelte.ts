import { debounce } from '@any-listen/common/utils'

export const scrollPointerEvents = (dom: HTMLElement) => {
  let isListScrolling = false
  const targetDom = dom.firstChild?.nodeType === Node.ELEMENT_NODE ? (dom.firstChild as HTMLElement) : dom
  const setStopScrollStatus = debounce(() => {
    isListScrolling = false
    targetDom.style.pointerEvents = 'auto'
  }, 200)
  const onScroll = () => {
    if (!isListScrolling) {
      isListScrolling = true
      targetDom.style.pointerEvents = 'none'
    }
    setStopScrollStatus()
  }

  dom.addEventListener('scroll', onScroll, {
    passive: true,
  })

  return () => {
    dom.removeEventListener('scroll', onScroll)
  }
}
