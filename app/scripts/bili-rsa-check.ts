/**
 * bili-rsa.ts 自测：用 Node crypto 生成临时 RSA 密钥对，验证
 * rsaEncryptB64 的输出可被标准 PKCS#1 v1.5 解密还原。
 * 运行：npx tsx scripts/bili-rsa-check.ts 或 esbuild 打包后 node。
 */
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { rsaEncryptB64 } from '../electron/core/bili-rsa'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
})

const hash = '64e1913896d0abc9'
const password = 'StarWish测试密码!@#2026'
const plain = hash + password

const encrypted = rsaEncryptB64(publicKey, plain)
console.log('[1] 密文长度(base64):', encrypted.length)

const decrypted = privateDecrypt(
  { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
  Buffer.from(encrypted, 'base64')
).toString('utf8')

console.log('[2] 解密还原:', decrypted === plain ? 'OK ✓' : `MISMATCH ✗\n  期望: ${plain}\n  实际: ${decrypted}`)

// 有效性：B 站真实公钥能被解析（不加密、只验 DER 路径）
const realKey = `-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDjb4V7EidX/ym28t2ybo0U6t0n\n6p4ej8VjqKHg100va6jkNbNTrLQqMCQCAYtXMXXp2Fwkk6WR+12N9zknLjf+C9sx\n/+l48mjUU8RqahiFD1XT/u2e0m2EN029OhCgkHx3Fc/KlFSIbak93EH/XlYis0w+\nXl69GV6klzgxW6d2xQIDAQAB\n-----END PUBLIC KEY-----`
const enc2 = rsaEncryptB64(realKey, plain)
console.log('[3] B 站真实公钥加密:', enc2.length > 0 && !enc2.includes(' ') ? 'OK ✓' : 'FAIL ✗')

if (decrypted !== plain) process.exit(1)
console.log('[done] RSA 实现验证通过')
