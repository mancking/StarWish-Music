<script lang="ts">
  import Btn from '@/components/base/Btn.svelte'
  import TitleContent from '../components/TitleContent.svelte'
  import { t } from '@/plugins/i18n'
  import { openUrl } from '@/shared/ipc/app'

  const donate = async () => {
    // if (await showSimpleConfirmModal($t('donate_tip'))) {
    //   console.log('object')
    // }
    void openUrl('https://donate.toside.cn/qrcode/')
  }
</script>

<TitleContent>
  <div class="settings-about">
    <p>
      {$t('settings__about_p1')}
    </p>
    <p>
      {$t('settings__about_p2')}
    </p>
    <p>
      {$t('settings__about_p3')}
    </p>
    <p>
      {$t('settings__about_p4')}
      <Btn
        link
        onclick={() => {
          void openUrl('https://github.com/any-listen/any-listen#readme')
        }}
      >
        https://github.com/any-listen/any-listen
      </Btn>
    </p>
    <Btn onclick={donate}>{$t('donate')}</Btn>
  </div>
</TitleContent>

<style lang="less">
  .settings-about {
    margin-left: 16px;
    font-size: 14px;
  }
  p {
    margin-bottom: 6px;

    :global(button.link) {
      color: inherit;
      text-decoration: underline;
    }
  }
</style>
