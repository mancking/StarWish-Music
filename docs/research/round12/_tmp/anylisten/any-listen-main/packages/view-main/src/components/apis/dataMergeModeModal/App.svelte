<script lang="ts">
  import Modal from '@/components/material/Modal.svelte'
  import Btn from '@/components/base/Btn.svelte'
  import Checkbox from '@/components/base/Checkbox.svelte'
  import { t } from '@/plugins/i18n'
  import { CANCELED_ERROR_MSG } from '@any-listen/common/constants'

  let {
    onafterleave,
  }: {
    onafterleave: () => void
  } = $props()

  let visible = $state(false)
  let currentType = $state<'list' | 'dislike'>('list')
  let isOverwrite = $state(false)
  let hideRemoteOverwriteOption = $state(false)
  let promise: [(result: AnyListen.List.MergeMode | AnyListen.Dislike.MergeMode) => void, (error: Error) => void] | null = null

  const closeModal = () => {
    visible = false
  }

  const handleAfterLeave = () => {
    onafterleave?.()
  }

  const cancelPending = () => {
    const currentPromise = promise
    promise = null
    currentPromise?.[1](new Error(CANCELED_ERROR_MSG))
  }

  const resolvePending = (mode: AnyListen.List.MergeMode | AnyListen.Dislike.MergeMode) => {
    const currentPromise = promise
    promise = null
    console.log('mode', mode)
    currentPromise?.[0](mode)
  }

  const handleSelectMode = (mode: AnyListen.List.MergeMode | AnyListen.Dislike.MergeMode) => {
    let selectedMode = mode
    if (currentType == 'list' && selectedMode.startsWith('overwrite') && isOverwrite) {
      selectedMode = `${selectedMode}_full` as AnyListen.List.MergeMode
    }
    resolvePending(selectedMode)
    closeModal()
  }

  export const show = async (syncType: 'list' | 'dislike', _hideRemoteOverwriteOption = false) => {
    currentType = syncType
    hideRemoteOverwriteOption = _hideRemoteOverwriteOption
    isOverwrite = false
    visible = true
    return new Promise<AnyListen.List.MergeMode | AnyListen.Dislike.MergeMode>((resolve, reject) => {
      promise = [resolve, reject]
    })
  }

  export const hide = () => {
    closeModal()
    cancelPending()
  }
</script>

<Modal
  bind:visible
  teleport="#root"
  minheight="0"
  bgclose={false}
  closebtn={false}
  keyclose={false}
  onafterleave={handleAfterLeave}
>
  {#if currentType == 'list'}
    <main class="main">
      <h2>{$t('sync.list_title')}</h2>
      <div class="scroll content">
        <dl class="btn-group">
          <dt class="label">{$t('sync.merge_label')}</dt>
          <dd class="btns">
            <Btn onclick={() => handleSelectMode('merge_local_remote')}>{$t('sync.merge_btn_local_remote')}</Btn>
            <Btn onclick={() => handleSelectMode('merge_remote_local')}>{$t('sync.merge_btn_remote_local')}</Btn>
          </dd>
        </dl>
        <dl class="btn-group">
          <dt class="label">{$t('sync.overwrite_label')}</dt>
          <dd class="btns">
            {#if !hideRemoteOverwriteOption}
              <Btn onclick={() => handleSelectMode('overwrite_local_remote')}>{$t('sync.overwrite_btn_local_remote')}</Btn>
            {/if}
            <Btn onclick={() => handleSelectMode('overwrite_remote_local')}>{$t('sync.overwrite_btn_remote_local')}</Btn>
          </dd>
          <dd style=" margin-top: 5px;font-size: 14px;">
            <Checkbox
              id="sync_mode_modal_isOverwrite"
              checked={isOverwrite}
              onchange={(checked) => {
                isOverwrite = checked
              }}
              label={$t('sync.overwrite')}
            />
          </dd>
        </dl>
        <dl class="btn-group">
          <dt class="label">{$t('sync.other_label')}</dt>
          <dd class="btns">
            <Btn onclick={() => handleSelectMode('cancel')}>{$t('sync.overwrite_btn_cancel')}</Btn>
          </dd>
        </dl>
        <dl class="btn-group">
          <dd>
            <section class="tip-group">
              <h3 class="title">{$t('sync.merge_tip')}</h3>
              <p class="tip">{$t('sync.list_merge_tip_desc')}</p>
            </section>
            <section class="tip-group">
              <h3 class="title">{$t('sync.overwrite_tip')}</h3>
              <p class="tip">{$t('sync.list_overwrite_tip_desc')}</p>
            </section>
            <section class="tip-group">
              <h3 class="title">{$t('sync.other_tip')}</h3>
              <p class="tip">{$t('sync.list_other_tip_desc')}</p>
            </section>
          </dd>
        </dl>
      </div>
    </main>
  {:else if currentType == 'dislike'}
    <main class="main">
      <h2>{$t('sync.dislike_title')}</h2>
      <div class="scroll content">
        <dl class="btn-group">
          <dt class="label">{$t('sync.merge_label')}</dt>
          <dd class="btns">
            <Btn onclick={() => handleSelectMode('merge_local_remote')}>{$t('sync.merge_btn_local_remote')}</Btn>
            <Btn onclick={() => handleSelectMode('merge_remote_local')}>{$t('sync.merge_btn_remote_local')}</Btn>
          </dd>
        </dl>
        <dl class="btn-group">
          <dt class="label">{$t('sync.overwrite_label')}</dt>
          <dd class="btns">
            <Btn onclick={() => handleSelectMode('overwrite_local_remote')}>{$t('sync.overwrite_btn_local_remote')}</Btn>
            <Btn onclick={() => handleSelectMode('overwrite_remote_local')}>{$t('sync.overwrite_btn_remote_local')}</Btn>
          </dd>
        </dl>
        <dl class="btn-group">
          <dt class="label">{$t('sync.other_label')}</dt>
          <dd class="btns">
            <Btn onclick={() => handleSelectMode('cancel')}>{$t('sync.overwrite_btn_cancel')}</Btn>
          </dd>
        </dl>
        <dl class="btn-group">
          <dd>
            <section class="tip-group">
              <h3 class="title">{$t('sync.merge_tip')}</h3>
              <p class="tip">{$t('sync.dislike_merge_tip_desc')}</p>
            </section>
            <section class="tip-group">
              <h3 class="title">{$t('sync.overwrite_tip')}</h3>
              <p class="tip">{$t('sync.dislike_overwrite_tip_desc')}</p>
            </section>
            <section class="tip-group">
              <h3 class="title">{$t('sync.other_tip')}</h3>
              <p class="tip">{$t('sync.dislike_other_tip_desc')}</p>
            </section>
          </dd>
        </dl>
      </div>
    </main>
  {/if}
</Modal>

<style lang="less">
  .main {
    display: flex;
    flex-flow: column nowrap;
    justify-content: center;
    min-width: 200px;
    max-width: 700px;
    min-height: 0;
    padding: 15px;

    h2 {
      font-size: 16px;
      line-height: 1.3;
      color: var(--color-font);
      text-align: center;
    }
  }

  .content {
    flex: auto;
    padding: 15px 0 5px;
    padding-right: 5px;

    .btn-group + .btn-group {
      margin-top: 10px;
    }

    .label {
      font-size: 14px;
      line-height: 2;
      color: var(--color-font-label);
    }

    .tip-group {
      display: flex;
      flex-direction: row;
      font-size: 12px;

      + .tip-group {
        margin-top: 5px;
      }

      .title {
        margin-right: 5px;
        font-weight: bold;
        white-space: nowrap;
      }

      .tip {
        line-height: 1.3;
      }
    }
  }

  .btns {
    display: flex;
    gap: 15px;
    align-items: center;
  }

  :global(.btn) {
    display: block;
    white-space: nowrap;
  }
</style>
