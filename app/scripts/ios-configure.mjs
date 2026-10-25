/**
 * iOS 设备形态配置：把 Capacitor 生成的单工程裁剪成「仅 iPhone」或「仅 iPad」，
 * 产出两个配置不同、不可互换的 ipa。
 *
 * 用法：node scripts/ios-configure.mjs <phone|ipad>
 *
 * 必须在 `npx cap add ios` 之后、`xcodebuild` 之前执行。
 * 依赖 Xcode 自带的 PlistBuddy（/usr/libexec/PlistBuddy），只在 macOS runner 上可用。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const path = require('node:path')
const fs = require('node:fs')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(__dirname, '..')

const PLIST_BUDDY = '/usr/libexec/PlistBuddy'

/**
 * 两种设备形态的全部差异参数，集中在一处便于对照：
 *   - deviceFamily 1=iPhone/iPod，2=iPad，决定 App Store 与系统允许安装的设备
 *   - orientations 决定支持的方向及优先级顺序
 *   - displayName 决定桌面图标下的显示名
 *   - bundleId 与 workflow 里 xcodebuild 的 PRODUCT_BUNDLE_IDENTIFIER 保持一致
 */
const PROFILES = {
  phone: {
    label: '手机版',
    bundleId: 'com.starwish.music.phone',
    displayName: '星河音乐',
    deviceFamily: 1,
    // 竖屏优先：主界面与列表按竖屏设计，横屏用于 MV / 全屏歌词
    orientations: [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ],
  },
  ipad: {
    label: 'iPad 版',
    bundleId: 'com.starwish.music.ipad',
    displayName: '星河音乐 HD',
    deviceFamily: 2,
    // 横屏优先：大屏播放页按左右两栏（封面/歌词）设计
    orientations: [
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
    ],
  },
}

const which = process.argv[2]
const profile = PROFILES[which]
if (!profile) {
  console.error(`[ios-configure] 用法：node scripts/ios-configure.mjs <${Object.keys(PROFILES).join('|')}>`)
  process.exit(1)
}

const plist = path.join(appDir, 'ios', 'App', 'App', 'Info.plist')
if (!fs.existsSync(plist)) {
  console.error(`[ios-configure] 找不到 ${plist}，请先执行 npx cap add ios`)
  process.exit(1)
}

const buddy = (...args) =>
  execFileSync(PLIST_BUDDY, args.flatMap(a => ['-c', a]).concat(plist), { stdio: 'pipe' })

/** 删除键；不存在时静默返回 false（PlistBuddy 对缺键 Delete 会非零退出） */
function delKey(keyPath) {
  try {
    buddy(`Delete :${keyPath}`)
    return true
  } catch {
    return false
  }
}

/** 覆盖写入一个值：先删再按指定类型 Add，避免 Set 因缺键失败或类型不符 */
function putKey(keyPath, value, type = 'string') {
  delKey(keyPath)
  buddy(`Add :${keyPath} ${type} ${value}`)
}

/** 覆盖写入一个字符串数组 */
function putArray(keyPath, values) {
  delKey(keyPath)
  buddy(`Add :${keyPath} array`)
  values.forEach((v, i) => buddy(`Add :${keyPath}:${i} string ${v}`))
}

// 显示名：两个 ipa 在桌面图标下可区分（星河音乐 / 星河音乐 HD）
putKey('CFBundleDisplayName', profile.displayName)

// 设备族：只留单一值，确保 iPhone 版装不进 iPad 之外的要求、iPad 版装不进 iPhone
delKey('UIDeviceFamily')
buddy('Add :UIDeviceFamily array')
buddy(`Add :UIDeviceFamily:0 integer ${profile.deviceFamily}`)

// 方向表：单一设备形态只用通用键，不保留 ~iphone / ~ipad 特化键（否则会被系统优先采用）
putArray('UISupportedInterfaceOrientations', profile.orientations)
delKey('UISupportedInterfaceOrientations~iphone')
delKey('UISupportedInterfaceOrientations~ipad')

// 分屏多窗口：iPad 版允许 Slide Over / Split View，手机版保持全屏即可
putKey('UIRequiresFullScreen', 'false', 'bool')

// 记录本次构建的目标形态，便于 workflow 与人工核对产物配置
fs.writeFileSync(
  path.join(appDir, 'ios', 'App', 'ios-profile.json'),
  JSON.stringify(
    {
      profile: which,
      label: profile.label,
      bundleId: profile.bundleId,
      displayName: profile.displayName,
      deviceFamily: profile.deviceFamily,
      orientations: profile.orientations,
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

console.log(
  `[ios-configure] 已配置 ${profile.label}：UIDeviceFamily=${profile.deviceFamily} ` +
    `bundleId=${profile.bundleId} displayName=${profile.displayName}`,
)
