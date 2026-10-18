/**
 * node:crypto 的浏览器垫片。
 *
 * 内置 11 个音源**没有一个**用到 `utils.crypto.*`（grep 实证），只有
 * `electron/core/bili.ts` 生成 buvid 时用到 `randomBytes`。因此这里：
 *  - randomBytes / randomUUID → Web Crypto `getRandomValues`
 *  - createHash / createHmac → **明确抛中文错误**，绝不静默错算
 *    （宁可音源报错，也不能给出错误的 md5 签名把请求发出去）
 */
function rb(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function randomBytes(n: number): Uint8Array {
  return rb(n)
}

export function randomUUID(): string {
  return crypto.randomUUID()
}

export function createHash(_alg: string): never {
  throw new Error('当前音源需要 ' + _alg + ' 摘要计算，移动端暂不支持该音源')
}

export function createHmac(_alg: string, _key: any): never {
  throw new Error('当前音源需要 ' + _alg + ' HMAC 计算，移动端暂不支持该音源')
}

export function createCipheriv(_alg: string, _key: any, _iv: any): never {
  throw new Error('当前音源需要对称加密，移动端暂不支持该音源')
}

export function createDecipheriv(_alg: string, _key: any, _iv: any): never {
  throw new Error('当前音源需要对称解密，移动端暂不支持该音源')
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export default { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual }
