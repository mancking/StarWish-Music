<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    stroke?: number
    fill?: boolean
  }>(),
  { size: 18, stroke: 1.8, fill: false }
)

const PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  compass:
    '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2z"/>',
  video: '<rect x="2.5" y="5" width="14" height="14" rx="3"/><path d="m16.5 10 5-3v10l-5-3z"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3c0 5-7.5 9.6-7.5 9.6z"/>',
  message:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V14a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16.5H6.5A2.5 2.5 0 0 1 4 14z"/>',
  'heart-filled':
    '<path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3c0 5-7.5 9.6-7.5 9.6z" fill="currentColor"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'folder-open':
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V10"/><path d="M3 10h18l-2 9a2 2 0 0 1-2 1.6H5A2 2 0 0 1 3 19z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18.5 5v14L8 12z" fill="currentColor" stroke="none"/><rect x="4.5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M5.5 5v14L16 12z" fill="currentColor" stroke="none"/><rect x="17.1" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  shuffle:
    '<path d="M3 7h3.2c1.4 0 2.6.7 3.4 1.9l4.8 7.2c.8 1.2 2 1.9 3.4 1.9H21"/><path d="m18 4 3 3-3 3"/><path d="M3 17h3.2c1.4 0 2.6-.7 3.4-1.9l1-1.5"/><path d="M14.2 9.4l.8-1.2c.8-1.2 2-1.9 3.4-1.9H21"/><path d="m18 14 3 3-3 3"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
  'repeat-one':
    '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/><path d="M11.4 10.6 12.6 10v4"/>',
  volume: '<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4"/><path d="M18.2 6.2a8.4 8.4 0 0 1 0 11.6"/>',
  'volume-low': '<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="M15.5 9.2a4.2 4.2 0 0 1 0 5.6"/>',
  'volume-mute':
    '<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
  queue: '<path d="M4 6h11"/><path d="M4 12h11"/><path d="M4 18h7"/><path d="M17.5 14.5v5.2"/><circle cx="16" cy="19.6" r="1.9"/><path d="M17.5 14.5 21 13v5.5"/>',
  lyric: '<path d="M5 5h14"/><path d="M5 10h9"/><path d="M5 15h11"/><path d="M5 20h6"/><path d="M17.6 12.4v5"/><circle cx="16.2" cy="17.6" r="1.6"/>',
  expand: '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/>',
  shrink: '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M4 15h5v5"/><path d="M20 15h-5v5"/>',
  'chevron-left': '<path d="m14.5 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9.5 5 7 7-7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  'chevron-up': '<path d="m5 15 7-7 7 7"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4.5 20h15"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="m14.5 5.5 4 4"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7"/><path d="M12 16.5v4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4.5V11h-6.5"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5"/>',
  list: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="16" r="2.6"/>',
  star: '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v6.5a1.5 1.5 0 0 1-1.5 1.5h0A1.5 1.5 0 0 1 4 20.5z"/><path d="M20 14h-3v6.5a1.5 1.5 0 0 0 1.5 1.5h0a1.5 1.5 0 0 0 1.5-1.5z"/>',
  sparkles: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/><path d="M18.5 16.5 19.2 19l2.3.7-2.3.8-.7 2.5-.8-2.5-2.4-.8 2.4-.7z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21"/>',
  radio: '<circle cx="12" cy="12" r="2.4"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  cloud: '<path d="M7 18h10.5a3.8 3.8 0 0 0 .4-7.6A5.6 5.6 0 0 0 7.2 9.4 4.3 4.3 0 0 0 7 18z"/>',
  wifi: '<path d="M3.5 9.5a13 13 0 0 1 17 0"/><path d="M6.5 13a9 9 0 0 1 11 0"/><path d="M9.5 16.4a5 5 0 0 1 5 0"/><circle cx="12" cy="19.4" r="1" fill="currentColor" stroke="none"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>',
  palette:
    '<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.6 1.1-2.4 2.6-2.4H18a3 3 0 0 0 3-3A8.8 8.8 0 0 0 12 3z"/><circle cx="7.6" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.4" r="1.1" fill="currentColor" stroke="none"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 13 4-4"/><circle cx="12" cy="14" r="1.6"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="12" rx="2.4"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01"/>',
  'hard-drive':
    '<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 13h19"/><circle cx="6.5" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="16" r="1" fill="currentColor" stroke="none"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.4"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  qr: '<rect x="3.5" y="3.5" width="6" height="6" rx="1.4"/><rect x="14.5" y="3.5" width="6" height="6" rx="1.4"/><rect x="3.5" y="14.5" width="6" height="6" rx="1.4"/><path d="M14.5 14.5h2.5v2.5h-2.5zM19.5 14.5h1v1M19.5 19.5h1v1M14.5 19.5h2.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',
  cast: '<path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M3 19a8 8 0 0 0-0 0"/><path d="M3 15a4 4 0 0 1 4 4"/><path d="M3 11a8 8 0 0 1 8 8"/>',
  sort: '<path d="M7 4v16"/><path d="m4 17 3 3 3-3"/><path d="M14 7h6"/><path d="M14 12h4.5"/><path d="M14 17h3"/>',
  microphone: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
  album: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  logout: '<path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>',
  loading: '<path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5"/>',
  zap: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  filter: '<path d="M3.5 5h17l-6.5 7.5V20l-4-2v-5.5z"/>',
  drag: '<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
  'arrow-up': '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>',
  'play-circle': '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none"/>',
}

const inner = computed(() => PATHS[props.name] || PATHS.music)
const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="sw-icon"
    aria-hidden="true"
    v-html="inner"
  />
</template>

<style scoped>
.sw-icon {
  display: block;
  flex: none;
}
</style>
