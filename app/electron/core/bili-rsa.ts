/**
 * B 站密码登录的 RSA 加密（纯 JS，桌面 Node 与移动端 WebView 共用）。
 *
 * 流程：`/x/passport-login/web/key` 返回 16 位 hash 与 PEM 公钥（1024bit），
 * 对 `hash + password` 做 RSA/PKCS#1 v1.5 加密，结果 base64 后作为 password
 * 提交 `POST /x/passport-login/web/login`。
 *
 * 依赖 big-integer 做 modPow；DER 解析只实现 SubjectPublicKeyInfo 里取
 * modulus/exponent 的最小路径。
 */
import bigInt from 'big-integer'

type BigInteger = ReturnType<typeof bigInt>

/* ---------------- base64（自实现，避开 Buffer/btoa 平台差异） ---------------- */

const B64S = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToB64(bytes: number[]): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64S[(n >> 18) & 63] + B64S[(n >> 12) & 63] + B64S[(n >> 6) & 63] + B64S[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64S[(n >> 18) & 63] + B64S[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64S[(n >> 18) & 63] + B64S[(n >> 12) & 63] + B64S[(n >> 6) & 63] + '='
  }
  return out
}

function b64ToBytes(s: string): number[] {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const c of clean) {
    buf = (buf << 6) | B64S.indexOf(c)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return out
}

/* ---------------- 最小 DER 解析：从 PEM 公钥取 (n, e) ---------------- */

interface Tlv {
  tag: number
  value: number[]
  next: number // value 之后的位置
}

function readTlv(b: number[], off: number): Tlv {
  const tag = b[off]
  let p = off + 1
  let len = b[p++]
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[p++]
  }
  return { tag, value: b.slice(p, p + len), next: p + len }
}

/** 解析 SubjectPublicKeyInfo PEM，返回 [modulus, exponent] 两个大整数的字节数组 */
function parsePublicKeyPem(pem: string): { n: number[]; e: number[] } {
  const body = b64ToBytes(
    String(pem)
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '')
  )
  const outer = readTlv(body, 0) // SEQUENCE
  let p = 0
  const alg = readTlv(outer.value, p) // AlgorithmIdentifier SEQUENCE（跳过）
  p = alg.next
  const bitstr = readTlv(outer.value, p) // BIT STRING
  if (bitstr.tag !== 0x03) throw new Error('公钥格式异常（BIT STRING 缺失）')
  const inner = bitstr.value.slice(1) // 去掉 unused-bits 字节
  const seq = readTlv(inner, 0) // RSAPublicKey SEQUENCE
  const int1 = readTlv(seq.value, 0) // INTEGER n
  const int2 = readTlv(seq.value, int1.next) // INTEGER e
  const strip = (v: number[]) => (v.length > 1 && v[0] === 0 ? v.slice(1) : v)
  return { n: strip(int1.value), e: strip(int2.value) }
}

function bytesToBigInt(b: number[]): BigInteger {
  let x = bigInt(0)
  for (const byte of b) x = x.shiftLeft(8).add(byte)
  return x
}

function bigIntToBytes(x: BigInteger, len: number): number[] {
  const out = new Array<number>(len).fill(0)
  let v = x
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v.and(0xff).toJSNumber()
    v = v.shiftRight(8)
  }
  return out
}

/* ---------------- 对外 ---------------- */

/**
 * RSA/PKCS#1 v1.5 加密 `plain`，返回 base64 密文。
 * 随机填充字节取自 crypto.getRandomValues / node crypto（两端都可用）。
 */
export function rsaEncryptB64(publicKeyPem: string, plain: string): string {
  const { n: nBytes, e: eBytes } = parsePublicKeyPem(publicKeyPem)
  const n = bytesToBigInt(nBytes)
  const e = bytesToBigInt(eBytes)
  const k = nBytes.length // 模长字节数（1024bit → 128）

  const msg: number[] = Array.from(new TextEncoder().encode(plain))
  if (msg.length > k - 11) throw new Error('密码过长，加密失败')

  const psLen = k - msg.length - 3
  const ps = new Array<number>(psLen)
  const rnd = new Uint8Array(psLen * 2)
  ;(globalThis as any).crypto?.getRandomValues?.(rnd)
  let ri = 0
  for (let i = 0; i < psLen; i++) {
    // 非零随机字节
    let b = 0
    while (b === 0) {
      if (ri >= rnd.length) {
        ;(globalThis as any).crypto?.getRandomValues?.(rnd)
        ri = 0
      }
      b = rnd[ri++]
    }
    ps[i] = b
  }
  const em = [0, 2, ...ps, 0, ...msg]
  const m = bytesToBigInt(em)
  const c = m.modPow(e, n)
  return bytesToB64(bigIntToBytes(c, k))
}
