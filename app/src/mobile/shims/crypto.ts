/**
 * node:crypto 的浏览器垫片（v1.0.0 升级：基于 crypto-js 真实现）。
 *
 * 旧实现把 createHash/createCipheriv 直接抛错 —— 后果是移动端上：
 *  - providers.ts 酷我榜单/歌单的 AES-128-ECB 解密直接崩（kw 榜单拉不到的根因之一）
 *  - wbi 签名（md5）抛错 → B站搜索降级
 * 现在用项目已有依赖 crypto-js 提供真实现（md5/sha1/sha256 + AES-128-ECB-CBC），
 * 与 node:crypto 行为对齐；仍不支持的算法（hmac 除外）才明确报中文错。
 */
import AES from 'crypto-js/aes'
import ECB from 'crypto-js/mode-ecb'
import Pkcs7 from 'crypto-js/pad-pkcs7'
import MD5 from 'crypto-js/md5'
import SHA1 from 'crypto-js/sha1'
import SHA256 from 'crypto-js/sha256'
import HexEnc from 'crypto-js/enc-hex'
import Utf8Enc from 'crypto-js/enc-utf8'
import Base64Enc from 'crypto-js/enc-base64'
import WordArray from 'crypto-js/lib-typedarrays'
import type { CipherParams } from 'crypto-js'

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

function toWA(data: any): any {
  if (typeof data === 'string') return Utf8Enc.parse(data)
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data ?? [])
  return WordArray.create(u8)
}

const DIGESTS: Record<string, (w: any) => any> = {
  md5: (w) => MD5(w),
  sha1: (w) => SHA1(w),
  sha256: (w) => SHA256(w),
}

/** 与 node:crypto 对齐：createHash(alg).update(data).digest('hex'|'base64') */
export function createHash(alg: string): { update: (d: any) => typeof r; digest: (enc?: string) => string } {
  const fn = DIGESTS[String(alg || '').toLowerCase().replace('-', '')]
  if (!fn) throw new Error(`当前音源需要 ${alg} 摘要计算，移动端暂不支持该算法`)
  let w: any = null
  const r = {
    update(d: any) {
      w = fn(toWA(d))
      return r
    },
    digest(enc?: string): string {
      const out: any = w ?? fn(toWA(''))
      const e = String(enc || 'hex').toLowerCase()
      if (e === 'hex') return out.toString(HexEnc)
      if (e === 'base64') return out.toString(Base64Enc)
      return out.toString(HexEnc)
    },
  }
  return r
}

export function createHmac(_alg: string, _key: any): never {
  throw new Error('当前音源需要 HMAC 计算，移动端暂不支持该算法')
}

function splitAlg(alg: string): { mode: any; pad: any } {
  const m = /^aes-(128|192|256)-ecb$/i.exec(String(alg || ''))
  if (!m) throw new Error(`当前音源需要 ${alg}，移动端仅支持 AES-*-ECB`)
  return { mode: ECB, pad: Pkcs7 }
}

/** AES-128/256-ECB + PKCS7：与桌面 node:crypto 默认 autoPadding 行为对齐（酷我榜单/歌单协议）。 */
export function createCipheriv(alg: string, key: any, _iv: any) {
  const { mode, pad } = splitAlg(alg)
  const kw = toWA(key)
  return {
    update(d: any): Buffer {
      const p: CipherParams = AES.encrypt(toWA(d), kw, { mode, padding: pad })
      const hex = p.ciphertext!.toString(HexEnc)
      return Buffer.from(hex, 'hex')
    },
    final(): Buffer {
      return Buffer.alloc(0)
    },
    setAutoPadding(): void {
      /* noop */
    },
  }
}

export function createDecipheriv(alg: string, key: any, _iv: any) {
  const { mode, pad } = splitAlg(alg)
  const kw = toWA(key)
  return {
    update(d: any): Buffer {
      const wa = toWA(d)
      const p: CipherParams = AES.decrypt({ ciphertext: wa } as any, kw, { mode, padding: pad })
      const hex = p.toString(HexEnc)
      return Buffer.from(hex, 'hex')
    },
    final(): Buffer {
      return Buffer.alloc(0)
    },
    setAutoPadding(): void {
      /* noop */
    },
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export default { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual }
