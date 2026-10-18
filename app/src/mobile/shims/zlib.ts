/**
 * node:zlib 的浏览器垫片。
 * 内置音源未使用 zlib（grep 实证），仅保留最小形状，误用则抛中文错误。
 */
function unsupported(what: string): never {
  throw new Error(`当前音源需要 ${what} 压缩/解压能力，移动端暂不支持该音源`)
}

export function gunzipSync(_buf: any): never { return unsupported('gzip') }
export function gzipSync(_buf: any): never { return unsupported('gzip') }
export function inflateSync(_buf: any): never { return unsupported('deflate') }
export function deflateSync(_buf: any): never { return unsupported('deflate') }
export function brotliDecompressSync(_buf: any): never { return unsupported('brotli') }
export function createGunzip(): never { return unsupported('gzip') }

export default { gunzipSync, gzipSync, inflateSync, deflateSync, brotliDecompressSync, createGunzip }
