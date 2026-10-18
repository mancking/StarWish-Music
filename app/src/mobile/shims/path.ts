/** node:path 的浏览器垫片。虚拟 fs 统一用 POSIX 风格（前导 `/`）。 */
export const sep = '/'
export const delimiter = ':'

export function normalize(p: string): string {
  const abs = isAbsolute(p)
  const out: string[] = []
  for (const seg of String(p).split(/[\\/]/)) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  const s = '/' + out.join('/')
  return abs ? s : (out.length ? s : '.')
}

export function isAbsolute(p: string): boolean {
  const s = String(p)
  return s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s)
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'))
}

export function resolve(...parts: string[]): string {
  let out = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (!p) continue
    out = out ? p + '/' + out : p
    if (isAbsolute(p)) return normalize(out)
  }
  return normalize(out || '/')
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf('/')
  return i <= 0 ? '/' : n.slice(0, i)
}

export function basename(p: string, ext?: string): string {
  let b = normalize(p).split('/').pop() || ''
  if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length)
  return b
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i)
}

export const posix = { sep, delimiter, normalize, isAbsolute, join, resolve, dirname, basename, extname }
export const win32 = posix
export default { sep, delimiter, normalize, isAbsolute, join, resolve, dirname, basename, extname, posix, win32 }
