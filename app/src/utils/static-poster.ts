import { ref, watch, type Ref } from 'vue'

/**
 * GIF 静态化（dynamicBgOff 省电兜底）：把 GIF 首帧抽成 dataURL 供背景层使用。
 *
 * 背景：dynamicBgOff 是「动态背景省电」开关（规格 S2.2A），开启后 GIF 背景应回落静态。
 * CSS 无法暂停 <img>/background-image 的 GIF 动画，这里用 canvas 抽首帧实现真静态；
 * 抽帧失败（跨域污染 / 非动图 / 加载超时）返回空串，调用方退回原 URL（保持动画）。
 */
export function useStaticPoster(url: Ref<string>, enabled: Ref<boolean>): Ref<string> {
  const poster = ref('')
  let seq = 0
  watch(
    [url, enabled],
    async ([u, on]) => {
      poster.value = ''
      const my = ++seq
      if (!u || !on) return
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = u
        if (!img.complete) {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('poster load failed'))
            window.setTimeout(() => reject(new Error('poster load timeout')), 6000)
          })
        }
        if (my !== seq) return
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 96
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 96, 96)
        const data = canvas.toDataURL('image/webp', 0.9)
        if (my === seq) poster.value = data
      } catch {
        /* 抽帧失败 → 调用方退回原 URL（保持动画） */
      }
    },
    { immediate: true }
  )
  return poster
}
