/**
 * B 站登录链路联调（真实接口，只读安全操作）：
 *  1. biliQrGenerate —— 应拿到真实二维码 url+key
 *  2. biliPasswordLogin —— 假账号应命中风控（-105）并转成友好中文提示
 *  3. biliCookieLogin —— 假 Cookie 应提示无效
 * 运行：node .tmp/bili-login-check.cjs（先 esbuild 打包）
 */
import { initBiliLogin, biliQrGenerate, biliPasswordLogin, biliCookieLogin, biliStatus } from '../electron/core/bili'

async function main() {
  initBiliLogin()

  console.log('--- 1. QR generate ---')
  try {
    const r = await biliQrGenerate()
    console.log('OK:', JSON.stringify({ hasUrl: !!r.url, urlPrefix: r.url.slice(0, 48), hasKey: !!r.key }))
  } catch (e: any) {
    console.log('FAIL:', e.message)
  }

  console.log('--- 2. password login (dummy) ---')
  try {
    const s = await biliPasswordLogin('13800000000', 'WrongPass123!')
    console.log('意外成功:', JSON.stringify(s))
  } catch (e: any) {
    console.log('预期错误 →', e.message)
  }

  console.log('--- 3. cookie login (dummy) ---')
  try {
    const s = await biliCookieLogin('SESSDATA=abc123def')
    console.log('意外成功:', JSON.stringify(s))
  } catch (e: any) {
    console.log('预期错误 →', e.message)
  }

  console.log('--- 4. status ---')
  console.log(JSON.stringify(biliStatus()))
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
