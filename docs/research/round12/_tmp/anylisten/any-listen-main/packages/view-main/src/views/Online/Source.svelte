<script lang="ts">
  import SvgIcon from '@/components/base/SvgIcon.svelte'
  import { verticalScrollbar } from '@/shared/compositions/verticalScrollbar.svelte'
  import { extT } from '@/modules/extension/i18n'
  import type { SourceType } from './shared.svelte'

  let {
    list,
    active,
    onchange,
  }: {
    list: SourceType[]
    active?: string
    onchange: (source: SourceType) => void
  } = $props()
</script>

<div class="source-list">
  <div class="list" {@attach verticalScrollbar({ offset: '0', scrollbarWidth: '0.4rem' })}>
    {#each list as source (source.sId)}
      <div
        role="button"
        tabindex="0"
        class="list-item"
        class:active={source.sId == active}
        aria-label={$extT(source.extensionId, source.name)}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            onchange(source)
          }
        }}
        onclick={() => {
          if (source.sId == active) return
          onchange(source)
        }}
      >
        {#if source.sId == active}
          <SvgIcon name="angle-right-solid" />
        {/if}
        {$extT(source.extensionId, source.name)}
      </div>
    {/each}
  </div>
</div>

<style lang="less">
  .source-list {
    flex: none;
    width: 15%;
    min-width: 50px;
    max-width: 200px;
    margin-bottom: 12px;
    margin-left: 12px;
    overflow: hidden;
    // border-right: 1px solid var(--color-border);
    background-color: var(--color-primary-light-300-alpha-900);
    border-radius: @radius-border;
    // border-top-left-radius: 8px;
    // border-top-right-radius: 8px;
    // border-bottom-right-radius: 8px;

    .list {
      height: 100%;
    }
    .list-item {
      position: relative;
      display: block;
      padding: 0 10px;
      font-size: 13px;
      line-height: 36px;
      background-color: transparent;
      border-radius: @radius-border;
      transition: 0.3s ease;
      transition-property: color, background-color;
      .mixin-ellipsis-1();

      &:hover:not(.active) {
        cursor: pointer;
        background-color: var(--color-primary-background-hover);
      }
      &.active {
        // background-color:
        color: var(--color-primary);
      }

      & > :global(svg) {
        width: 0.9em;
        height: 0.9em;
        margin-left: -0.45em;
        vertical-align: -0.05em;
      }
    }
  }
</style>
