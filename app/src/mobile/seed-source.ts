/**
 * 音源种子入口（通道切换点）。
 *
 * 构建时由 vite.mobile.config.ts 按 BUILD_CHANNEL 别名替换：
 *   - BUILD_CHANNEL=release → seed-empty.ts（零音源，0.11.1 硬约束）
 *   - 其余（dev 默认）     → seed-files.ts（内联 dev-sources/）
 *
 * 本文件只是类型检查/别名失效时的物理兜底，内容为空种子——
 * 任何未经别名替换的构建路径都保证零音源，不会泄漏 dev 源。
 */
export { SOURCE_FILES } from './seed-empty'
