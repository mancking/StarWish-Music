import type { Song } from '@shared/types'

/**
 * 各音源的显示别名（对齐参考实现的风格）。
 * 界面中不出现官方软件名称，只保留这一套别名。
 */
export const PLATFORM_LABEL: Record<string, string> = {
  wy: '小芸音乐',
  qq: '小秋音乐',
  kg: '小枸音乐',
  kw: '小蜗音乐',
  mg: '小蜜音乐',
  bili: '视频源',
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] || '在线音源'
}

export function songSourceLabel(song: Song | null | undefined): string {
  if (!song) return ''
  if (song.source === 'local') return '本地音源'
  if (song.source === 'bili') return '视频源'
  return '在线音源'
}

export const QUALITY_LABEL: Record<string, string> = {
  '128k': '标准',
  '320k': '高品质',
  flac: '无损',
  flac24bit: 'Hi-Res',
}
