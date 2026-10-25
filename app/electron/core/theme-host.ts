import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { userDataDir } from './paths'
import { getSettings, saveSettings } from './settings'
import { broadcast } from '../windows'
import { createLogger } from './log'

const logger = createLogger('theme-host')

/**
 * 主题自定义体系
 *
 * - 预置皮肤 3~5 套：星河默认 / 经典深色 / 琉璃 / 晨曦 / 暗夜紫，随包分发不依赖网络；
 * - 主题包（皮肤商店社区包）：JSON ≤256KB，字段白名单
 *   {name, author, version, colors:{primary,accent,bg,text}, wallpaperId?, playerBg?, fontScale?, borderRadius?}，
 * 非法字段丢弃；分发经 0.10 市场 kind=theme / URL / 本地导入 / Star-Wish-Theme-Library 分支；
 * - 应用/卸载即时生效（CSS 变量注入，渲染层监听 theme:changed）；卸载恢复默认主题。
 */

export interface ThemeColors {
  primary?: string
  accent?: string
  bg?: string
  text?: string
}

export interface ThemePackage {
  id: string
  name: string
  author: string
  version: string
  colors: ThemeColors
  wallpaperId?: string
  playerBg?: string
  fontScale?: number
  borderRadius?: number
  /** preset = 预置皮肤（不可卸载）；local/market/url = 已装主题包 */
  kind: 'preset' | 'local' | 'market' | 'url' | 'branch'
  file?: string
  desc?: string
}

export const PRESET_THEMES: ThemePackage[] = [
  {
    id: 'default',
    name: '星河默认',
    author: 'StarWish',
    version: '1.0.0',
    colors: { primary: '#a78bfa', accent: '#f472b6', bg: '#0b0b10', text: '#ececf1' },
    kind: 'preset',
    desc: '紫粉渐变 · 出厂默认',
  },
  {
    id: 'classic-dark',
    name: '经典深色',
    author: 'StarWish',
    version: '1.0.0',
    colors: { primary: '#8b8b9e', accent: '#c9c9d6', bg: '#0d0d0f', text: '#e8e8ec' },
    kind: 'preset',
    desc: '低饱和灰调 · 长时间阅读友好',
  },
  {
    id: 'glaze',
    name: '琉璃',
    author: 'StarWish',
    version: '1.0.0',
    colors: { primary: '#5eead4', accent: '#38bdf8', bg: '#0a1418', text: '#e6fbff' },
    kind: 'preset',
    desc: '青蓝透亮 · 琉璃光感',
  },
  {
    id: 'dawn',
    name: '晨曦',
    author: 'StarWish',
    version: '1.0.0',
    colors: { primary: '#fbbf24', accent: '#fb923c', bg: '#14100a', text: '#fdf3e3' },
    kind: 'preset',
    desc: '暖金晨光 · 琥珀基调',
  },
  {
    id: 'night-purple',
    name: '暗夜紫',
    author: 'StarWish',
    version: '1.0.0',
    colors: { primary: '#7c3aed', accent: '#a855f7', bg: '#0a0714', text: '#ece9fb' },
    kind: 'preset',
    desc: '深空紫 · 夜间氛围',
  },
]

const HEX = /^#[0-9a-fA-F]{6}$/

function themesDir(): string {
  const d = path.join(userDataDir(), 'themes')
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {
    /* ignore */
  }
  return d
}

/**字段白名单校验，非法字段丢弃；≤256KB */
function validateTheme(raw: any, origin: ThemePackage['kind']): { theme: ThemePackage | null; dropped: string[] } {
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object') return { theme: null, dropped: ['根结构非对象'] }
  const name = String(raw.name || '').trim()
  if (!name) return { theme: null, dropped: ['缺少 name'] }
  const colors: ThemeColors = {}
  const rawColors = raw.colors && typeof raw.colors === 'object' ? raw.colors : {}
  for (const k of ['primary', 'accent', 'bg', 'text'] as const) {
    const v = String((rawColors as any)[k] || '')
    if (v && HEX.test(v)) (colors as any)[k] = v.toLowerCase()
    else if (v) dropped.push(`colors.${k} 非 #rrggbb`)
  }
  if (!colors.primary && !colors.accent) return { theme: null, dropped: [...dropped, 'colors 至少含 primary 或 accent'] }
  const theme: ThemePackage = {
    id: String(raw.id || crypto.createHash('sha1').update(name).digest('hex').slice(0, 10)),
    name: name.slice(0, 40),
    author: String(raw.author || '未知作者').slice(0, 40),
    version: String(raw.version || '1.0.0').slice(0, 16),
    colors,
    kind: origin,
  }
  if (raw.wallpaperId && typeof raw.wallpaperId === 'string') theme.wallpaperId = raw.wallpaperId.slice(0, 40)
  else if (raw.wallpaperId !== undefined) dropped.push('wallpaperId 非法')
  const pb = String(raw.playerBg || '')
  if (['cover', 'lyric-wall', 'particle', 'spectrum', 'gradient', 'wallpaper', 'solid'].includes(pb)) theme.playerBg = pb as any
  else if (raw.playerBg !== undefined) dropped.push('playerBg 非法')
  if (typeof raw.fontScale === 'number' && raw.fontScale >= 0.85 && raw.fontScale <= 1.3) theme.fontScale = raw.fontScale
  else if (raw.fontScale !== undefined) dropped.push('fontScale 越界（0.85~1.3）')
  if (typeof raw.borderRadius === 'number' && raw.borderRadius >= 0 && raw.borderRadius <= 20) theme.borderRadius = raw.borderRadius
  else if (raw.borderRadius !== undefined) dropped.push('borderRadius 越界（0~20）')
  return { theme, dropped }
}

export function listThemes(): ThemePackage[] {
  const installed: ThemePackage[] = []
  try {
    for (const f of fs.readdirSync(themesDir()).filter(x => x.endsWith('.json'))) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(themesDir(), f), 'utf8'))
        const { theme } = validateTheme(raw, (raw as any)?.__origin || 'local')
        if (theme) {
          theme.file = f
          installed.push(theme)
        }
      } catch {
        /* 跳过坏包 */
      }
    }
  } catch {
    /* ignore */
  }
  return [...PRESET_THEMES, ...installed]
}

/** 导入主题包（本地 JSON / URL 下载内容 / 市场下载，≤256KB + 白名单校验） */
export function importThemeContent(text: string, origin: ThemePackage['kind']): { theme: ThemePackage; dropped: string[] } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > 256 * 1024) throw new Error(`主题包超过 256KB 上限（${(bytes / 1024).toFixed(0)}KB）`)
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('主题包不是有效 JSON')
  }
  const { theme, dropped } = validateTheme(raw, origin)
  if (!theme) throw new Error(`主题包校验失败：${dropped.join('；')}`)
  const file = `${theme.id}.json`
 // 原子写：先 .tmp 再 rename（口径）
  const tmp = path.join(themesDir(), `${file}.tmp`)
  const target = path.join(themesDir(), file)
  fs.writeFileSync(tmp, JSON.stringify({ ...theme, __origin: origin }, null, 2), 'utf8')
  fs.renameSync(tmp, target)
  theme.file = file
  return { theme, dropped }
}

/** 应用主题：CSS 变量 + 设置字段（playerBg/wallpaperId）即时生效 */
/** 上一次皮肤注入的强调色：用于区分「用户手动改的主题色」与「皮肤自带色」，
 *  修「主题色设置无效」——切皮肤不再把用户手动选的主题色吸回皮肤色。 */
let lastThemeAccent = ''
export function applyTheme(id: string): ThemePackage {
  const all = listThemes()
  const t = all.find(x => x.id === id) || all.find(x => x.id === 'default')!
  const cur = getSettings() as any
  const userCustom =
    cur.accentMode === 'custom' && !!cur.accent && cur.accent !== lastThemeAccent
  const patch: Record<string, any> = { activeTheme: t.id }
  if (t.colors.accent && !userCustom) {
    patch.accentMode = 'custom'
    patch.accent = t.colors.accent
    lastThemeAccent = t.colors.accent
  }
  if (t.playerBg) patch.playerBg = t.playerBg
  if (t.wallpaperId) patch.wallpaperId = t.wallpaperId
  saveSettings(patch)
  broadcast('theme:changed', t)
  broadcast('settings:changed', getSettings())
  logger.info(`主题已应用：${t.name}（${t.id}）`)
  return t
}

/** 卸载主题包（预置皮肤不可卸载）；卸载后恢复默认主题 */
export function removeTheme(id: string): { ok: boolean; restored: string } {
  const t = listThemes().find(x => x.id === id)
  if (!t) throw new Error('主题不存在')
  if (t.kind === 'preset') throw new Error('预置皮肤不可卸载，可直接切回「星河默认」')
  if (t.file) {
    try {
      fs.rmSync(path.join(themesDir(), t.file), { force: true })
    } catch (e: any) {
      throw new Error(`删除失败：${e?.message || e}`)
    }
  }
  // 卸载恢复默认主题（4.7+ 落地要求）
  const active = String(getSettings().activeTheme || 'default')
  if (active === id) applyTheme('default')
  return { ok: true, restored: active === id ? 'default' : active }
}

export function getActiveTheme(): ThemePackage {
  const id = String(getSettings().activeTheme || 'default')
  return listThemes().find(x => x.id === id) || PRESET_THEMES[0]!
}
