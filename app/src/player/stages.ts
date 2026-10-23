import type { StageMode } from '@/stores/player'

/** 视觉模式四态顺序（规格书 1.4：封面 → 歌词 → 粒子 → 舞台） */
export const STAGE_ORDER: StageMode[] = ['cover', 'lyrics', 'particle', 'stage']

export const STAGE_ICON: Record<StageMode, string> = {
  cover: 'disc',
  lyrics: 'lyric',
  particle: 'sparkles',
  stage: 'gauge',
}

export const STAGE_LABEL: Record<StageMode, string> = {
  cover: '封面',
  lyrics: '歌词',
  particle: '粒子',
  stage: '舞台',
}

/** 循环模式文案（规格书 1.7 四态） */
export const LOOP_ICON: Record<string, string> = {
  'repeat-all': 'repeat',
  'repeat-one': 'repeat',
  shuffle: 'shuffle',
  order: 'list',
}
