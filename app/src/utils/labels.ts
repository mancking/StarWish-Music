import type { Song } from '@shared/types'

/** 界面中不出现任何官方软件名称，统一以「音源」表述 */
export const PLATFORM_LABEL: Record<string, string> = {
  wy: '音源 A',
  qq: '音源 B',
  kg: '音源 C',
  kw: '音源 D',
  mg: '音源 E',
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
