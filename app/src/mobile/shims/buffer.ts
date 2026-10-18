/**
 * `buffer` npm 包的轻量替身（Node 内置缓冲的 ESM 命名导出）。
 * Vite 在打包时会为 `import { Buffer } from 'buffer'` 走这个别名；
 * 真正的实现在 shims/util.ts（class BufferPoly）。
 */
import { Buffer } from './util'

export { Buffer }
export default { Buffer, Blob: typeof Blob !== 'undefined' ? Blob : undefined }
