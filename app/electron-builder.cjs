// electron-builder config v24+ — 独立 JS 配置文件（package.json 的 build 字段已移除，
// 因为 read-config-file 会优先使用 packageMetadata.build 而完全忽略本文件）。
// BUILD_CHANNEL=dev（默认）：把 dev-sources 复制到 resources/sources 后打进包内。
// BUILD_CHANNEL=release：零音源，gate-zero-source.mjs 门禁通过后才构建。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path')

const channel = process.env.BUILD_CHANNEL || 'dev'
const isRelease = channel === 'release'

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.starwish.music',
  productName: '星河音乐',
  copyright: 'Copyright \u00A9 2026 StarWish Music',
  directories: {
    output: 'dist/release',
    buildResources: 'resources',
  },
  asar: true,
  files: [
    'dist/electron/**/*',
    'dist/renderer/**/*',
    'node_modules/sql.js/dist/sql-wasm.wasm',
    'node_modules/sql.js/dist/sql-wasm.js',
    'package.json',
    '!**/*.map',
    '!**/node_modules/@capacitor/**',
    '!**/node_modules/@capacitor-community/**',
    '!**/node_modules/sql.js/dist/sql-asm*',
    '!**/node_modules/sql.js/dist/sql-shell.js',
    '!**/node_modules/sql.js/dist/sqljs-all.zip',
    '!**/node_modules/sql.js/dist/*.map',
  ],
  extraResources: [
    // Release 通道：零音源，不拷贝 sources
    // Dev 通道：dev-sources → resources/sources → 随包分发（仅开发/调试用）
    ...(isRelease ? [] : [{
      from: 'resources/sources',
      to: 'sources',
    }]),
    {
      from: 'resources',
      to: 'resources',
      filter: ['**/*', '!sources/*'],
    },
  ],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: 'resources/icon.ico',
    requestedExecutionLevel: 'asInvoker',
    artifactName: 'StarWish-${version}-win-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '星河音乐',
    artifactName: 'StarWish-${version}-Setup.${ext}',
    deleteAppDataOnUninstall: false,
  },
  portable: {
    artifactName: 'StarWish-${version}-win-portable.${ext}',
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    icon: 'resources/icon.png',
    category: 'public.app-category.music',
    identity: null,
    artifactName: 'StarWish-${version}-mac-${arch}.${ext}',
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'resources/icon.png',
    category: 'AudioVideo',
    artifactName: 'StarWish-${version}-linux-${arch}.${ext}',
  },
}

module.exports = config
