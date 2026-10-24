<script lang="ts">
  import Image from '@/components/base/Image.svelte'
  import { scrollListTo } from '@/modules/app/store/action'
  import { setShowPlayDetail } from '@/modules/playDetail/store/commit'
  import { musicInfo } from '@/modules/player/reactive.svelte'
  import { playerState } from '@/modules/player/store/state'
  let pic = $derived($musicInfo.pic)
</script>

<div class="container">
  <button
    type="button"
    class="btn"
    onclick={() => {
      setShowPlayDetail(true)
    }}
    oncontextmenu={() => {
      let mInfo = playerState.playMusicInfo
      if (!mInfo) return
      scrollListTo(mInfo.listId, mInfo.source, mInfo.musicInfo)
    }}
  >
    <Image decoding="auto" loading="eager" src={pic} />
  </button>
</div>

<style lang="less">
  .container {
    flex: none;
    min-width: 0;
    // width: @height-player;
    height: 100%;
    padding: 8px 10px;
  }
  .btn {
    display: block;
    height: 100%;
    aspect-ratio: 1;
    // aspect-ratio: 1;
    padding: 0;
    cursor: pointer;
    background: none;
    border: none;
    transition: opacity @transition-fast;

    &:hover {
      opacity: 0.6;
    }
  }
</style>
