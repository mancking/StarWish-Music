import type { AppSettings } from '@shared/types'
import type { StageMode } from '@/stores/player'

/**
 * 播放页背景模式
 * cover 封面（魔法色渐变）/ lyric-wall 歌词墙 / particle 粒子 / spectrum 舞台频谱；
 * gradient 低性能降级、solid 兜底；旧 wallpaper 归并移除。
 * 切换入口：「更多」菜单 + 底部「背景」按钮位（长按弹模式面板），不新增左右方向。
 */
export type BgMode = AppSettings['playerBg']

export const BG_ORDER: BgMode[] = ['cover', 'lyric-wall', 'particle', 'spectrum', 'gradient', 'wallpaper', 'solid']

export const BG_ICON: Record<BgMode, string> = {
  cover: 'disc',
  'lyric-wall': 'lyric',
  particle: 'sparkles',
  spectrum: 'gauge',
  gradient: 'palette',
  wallpaper: 'folder',
  solid: 'display',
}

export const BG_LABEL: Record<BgMode, string> = {
  cover: '封面',
  'lyric-wall': '歌词墙',
  particle: '粒子',
  spectrum: '舞台',
  gradient: '纯渐变',
  wallpaper: '壁纸',
  solid: '纯色',
}

/** 车机仅 cover/gradient（4.7 车机降级） */
export const carBgOrder = (bg: BgMode): BgMode => (bg === 'solid' ? 'solid' : 'gradient')

/** 页面态（cover/lyrics）标签 */
export const STAGE_LABEL: Record<StageMode, string> = {
  cover: '封面',
  lyrics: '歌词',
}

/** 循环模式图标 */
export const LOOP_ICON: Record<string, string> = {
  'repeat-all': 'repeat',
  'repeat-one': 'repeat',
  shuffle: 'shuffle',
  order: 'list',
}
