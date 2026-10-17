/** 从封面提取主色（median-cut 简化版：色相直方图 + 饱和度加权） */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function extractAccent(src: string, timeout = 6000): Promise<string> {
  return new Promise(resolve => {
    if (!src) {
      resolve('')
      return
    }
    let done = false
    const finish = (v: string) => {
      if (done) return
      done = true
      resolve(v)
    }
    const timer = window.setTimeout(() => finish(''), timeout)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      window.clearTimeout(timer)
      try {
        const size = 36
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return finish('')
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          if (a < 200) continue
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const [h, s, l] = rgbToHsl(r, g, b)
          if (s < 18 || l < 12 || l > 92) continue
          const key = Math.round(h / 24) % 15
          const weight = s * (1 - Math.abs(l - 52) / 100)
          const cur = buckets.get(key)
          if (cur) {
            cur.weight += weight
            cur.r += r
            cur.g += g
            cur.b += b
          } else {
            buckets.set(key, { weight, r, g, b })
          }
        }
        let best: { weight: number; r: number; g: number; b: number } | null = null
        for (const v of buckets.values()) if (!best || v.weight > best.weight) best = v
        if (!best) return finish('')
        const count = Math.max(1, Math.round(best.weight / 40))
        const [h, s, l] = rgbToHsl(best.r / count, best.g / count, best.b / count)
        const hex = hslToHex(h, Math.max(48, Math.min(78, s)), Math.max(44, Math.min(60, l)))
        finish(hex)
      } catch {
        finish('')
      }
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      finish('')
    }
    img.src = src
  })
}
