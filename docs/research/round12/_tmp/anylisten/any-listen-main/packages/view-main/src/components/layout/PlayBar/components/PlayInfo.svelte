<script lang="ts">
  import { lyricLine, lyricLines } from '@/modules/lyric/reactive.svelte'
  import { musicInfo, playerPlaying, statusText } from '@/modules/player/reactive.svelte'
  import { useSettingValue } from '@/modules/setting/reactive.svelte'
  import { buildMusicName } from '@any-listen/common/tools'
  let nameFormat = useSettingValue('download.fileName')

  let status = $derived($playerPlaying && $lyricLines.length ? $lyricLine.text : $statusText)
  let musicLabel = $derived.by(() => {
    const info = $musicInfo
    if (!info.id) return ''
    return buildMusicName(nameFormat.val, info.name, info.singer)
  })
</script>

<div class="container">
  <p class="name">{musicLabel}</p>
  <p class="status-text">{status}</p>
</div>

<style lang="less">
  .container {
    flex: auto;
    min-width: 0;
    contain: content;
  }
  .name {
    padding: 3px 0;
    font-size: 14px;
    color: var(--color-font-label);
    .mixin-ellipsis-1();
  }

  .status-text {
    box-sizing: content-box;
    height: 18px;
    padding-bottom: 3px;
    font-size: 15px;
    .mixin-ellipsis-1();
  }
</style>
