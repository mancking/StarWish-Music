/**
 * 二进制 → base64（移动端原生桥专用）
 *
 * 旧代码用 `btoa(String.fromCharCode(...buf.subarray(0, N)))`，
 * 把整个字节数组展开成函数实参。V8 的实参上限约 65535 个，
 * 因此任何超过 ~64KB 的文件都会抛
 * `RangeError: Maximum call stack size exceeded`；
 * 更糟的是旧代码还先 `subarray(0, 8MB)` 截断再报「已保存」，
 * 一旦没崩就会静默写出残缺文件。
 *
 * 这里改成分块拼接（每块 32KB 先转字符再 concat），不展开实参、不截断；
 * 超过上限时直接抛错，交给调用方如实提示，绝不静默产出坏文件。
 */

/** 单文件上限：原生侧一次传 80MB base64 已经不现实，超过直接拒绝 */
export const MAX_BASE64_BYTES = 64 * 1024 * 1024

const CHUNK = 32 * 1024

/** Uint8Array → base64 字符串（分块，避免实参展开） */
export function bytesToBase64(buf: Uint8Array): string {
  if (buf.length > MAX_BASE64_BYTES) {
    throw new Error(`文件过大（${(buf.length / 1024 / 1024).toFixed(1)}MB），超过 ${MAX_BASE64_BYTES / 1024 / 1024}MB 上限`)
  }
  const parts: string[] = []
  for (let i = 0; i < buf.length; i += CHUNK) {
    const slice = buf.subarray(i, i + CHUNK)
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]))
  }
  return btoa(parts.join(''))
}
