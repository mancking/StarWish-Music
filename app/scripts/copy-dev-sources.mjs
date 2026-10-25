/**
 * 开发期音源桥接：把 app/dev-sources/ 的 .js 复制到 app/resources/sources/，
 * 让 electron-builder 的 extraResources 在 dev 通道把音源打进 resources/sources。
 * release 通道不执行此脚本，发布包中不含任何音源。
 *
 * dev-sources/ 不入库（.gitignore），因此干净 checkout / CI 上可能不存在：
 * 此时直接跳过，依赖仓库内已跟踪的 resources/sources/ 内容完成打包。
 *
 * 用法：npm run build（已内置）或 BUILD_CHANNEL=release npm run build（清理 resources/sources）
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const src = path.join(root, 'dev-sources')
const dst = path.join(root, 'resources', 'sources')

if (process.env.BUILD_CHANNEL === 'release') {
  // release 通道：确保 resources/sources/ 不存在，避免旧文件残留被打包
  if (fs.existsSync(dst)) {
    fs.rmSync(dst, { recursive: true, force: true })
    console.log('[copy-dev-sources] release 通道：已清理 resources/sources')
  }
} else if (!fs.existsSync(src)) {
  // 干净 checkout / CI：dev-sources/ 未入库，跳过复制
  console.log('[copy-dev-sources] 跳过：dev-sources/ 不存在，沿用仓库内 resources/sources/')
} else {
  const files = fs.readdirSync(src).filter(f => f.endsWith('.js'))
  if (files.length === 0) {
    console.warn('[copy-dev-sources] 警告：dev-sources/ 为空，开发版将无内置音源')
  } else {
    fs.mkdirSync(dst, { recursive: true })
    for (const f of files) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f))
    }
    console.log(`[copy-dev-sources] 已复制 ${files.length} 个音源到 resources/sources/`)
  }
}
