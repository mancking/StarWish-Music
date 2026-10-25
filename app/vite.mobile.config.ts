import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from './package.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 音源种子入口选择：
 *   - release 通道 → 空种子
 *   - dev 通道但本地没有 dev-sources/（干净 checkout / CI）→ 空种子
 *   - dev 通道且有 dev-sources/ → seed-files.ts（内联音源）
 * seed-files.ts 与 dev-sources/ 都不入库，CI 上没有它们时必须回落空种子，
 * 否则 vite 解析别名时会因文件缺失直接构建失败。
 */
const hasDevSources = fs.existsSync(path.resolve(__dirname, 'dev-sources'))
const seedEntry = process.env.BUILD_CHANNEL !== 'release' && hasDevSources
  ? 'src/mobile/seed-files.ts'
  : 'src/mobile/seed-empty.ts'

/**
 * 移动端（WebView）打包配置。
 * 与桌面 `vite.config.ts` 的区别只在于：
 *  - 入口换成装好 window.sw 桥的 `main.mobile.ts`
 *  - 输出到 `dist/mobile`（Capacitor webDir），不碰桌面 `dist/renderer`
 *  - 把 node 内置模块别名到 `src/mobile/shims`，让 electron/core 原样复用
 */
export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
      // node:fs / path / os / vm / crypto / zlib / util → 浏览器垫片
      'node:fs': path.resolve(__dirname, 'src/mobile/shims/fs.ts'),
      'node:path': path.resolve(__dirname, 'src/mobile/shims/path.ts'),
      'node:os': path.resolve(__dirname, 'src/mobile/shims/os.ts'),
      'node:vm': path.resolve(__dirname, 'src/mobile/shims/vm.ts'),
      'node:crypto': path.resolve(__dirname, 'src/mobile/shims/crypto.ts'),
      'node:zlib': path.resolve(__dirname, 'src/mobile/shims/zlib.ts'),
      'node:util': path.resolve(__dirname, 'src/mobile/shims/util.ts'),
      // lx 音源沙箱需要 Buffer（core 直接引用全局 Buffer）
      'buffer': path.resolve(__dirname, 'src/mobile/shims/buffer.ts'),
      'electron': path.resolve(__dirname, 'src/mobile/shims/electron.ts'),
      // cover.ts 依赖 electron 的 protocol/net，移动端不用磁盘缓存
      './cover': path.resolve(__dirname, 'src/mobile/shims/cover.ts'),
      // bili.ts 的登录态：移动端用 localStorage 版（虚拟 fs 存 json 也可，
      // 但 localStorage 更稳、且能避开「先 initFs 后读」的顺序问题）
      './bili': path.resolve(__dirname, 'src/mobile/shims/bili-bridge.ts'),
      // paths.ts 的 sourcesDir 指向虚拟 fs 种子目录
      './paths': path.resolve(__dirname, 'src/mobile/shims/paths-mobile.ts'),
      // 音源种子文件：release / 无本地音源 → 空种子；dev 且有 dev-sources → 内联音源
      './seed-source': path.resolve(__dirname, seedEntry),
      // 跟跳转：移动端走原生 CapacitorHttp（拿得到 302 的 Location）
      './redirect': path.resolve(__dirname, 'src/mobile/shims/redirect-mobile.ts'),
      // db.ts 里 require('sql.js')
      'sql.js': path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.js'),
    },
  },
  define: {
    'process.platform': '"android"',
    'process.env.NODE_ENV': '"production"',
    __MOBILE__: 'true',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_CHANNEL__: JSON.stringify(process.env.BUILD_CHANNEL || 'dev'),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/mobile'),
    emptyOutDir: true,
    target: 'chrome120',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.mobile.html'),
    },
  },
})
