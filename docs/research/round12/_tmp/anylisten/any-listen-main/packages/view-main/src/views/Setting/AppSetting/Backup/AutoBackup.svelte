<script lang="ts">
  import { i18n, t } from '@/plugins/i18n'
  import TitleContent from '../../components/TitleContent.svelte'
  import Btn from '@/components/base/Btn.svelte'
  import { setBackupPath, openDirInExplorer, showOpenDialog } from '@/shared/ipc/app'
  import { useSettingValue } from '@/modules/setting/reactive.svelte'
  const backupPath = useSettingValue('backup.backupPath')

  const handleSelectBackupPath = async () => {
    const result = await showOpenDialog({
      title: i18n.t('settings.backup.save_dir'),
      properties: ['openDirectory'],
    })
    if (result.canceled) return
    await setBackupPath(result.filePaths[0])
  }

  const handleOpenBackupPath = () => {
    if (!backupPath.val) return
    void openDirInExplorer(backupPath.val)
  }
</script>

<TitleContent name={$t('settings.backup.auto_backup_title')} desc={$t('settings.backup.auto_backup_desc')}>
  <div class="settings-item-content">
    {#if import.meta.env.VITE_IS_DESKTOP}
      {#if backupPath.val}
        <p class="auto-hidden">
          {$t('settings.backup.auto_backup.backup_path_label')}
          <span class="hover save-path" role="presentation" aria-label={backupPath.val} onclick={handleOpenBackupPath}>
            {backupPath.val}
          </span>
        </p>
      {/if}
      <div class="btns">
        <Btn min onclick={handleSelectBackupPath}>
          {$t('settings.backup.auto_backup.change_dir')}
        </Btn>
        <Btn min onclick={async () => setBackupPath('')}>
          {$t('settings.backup.auto_backup.reset_dir')}
        </Btn>
      </div>
    {/if}
    {#if import.meta.env.VITE_IS_WEB}
      <p class="tip">{$t('settings.backup.auto_backup.web_tip')}</p>
    {/if}
  </div>
</TitleContent>

<style lang="less">
  .settings-item-content {
    display: flex;
    flex-flow: column nowrap;
    gap: 8px;
    // padding-top: 4px;

    .save-path {
      font-size: 13px;
    }
  }
  .btns {
    display: flex;
    gap: 8px;
  }
  .tip {
    font-size: 13px;
    font-style: italic;
    color: var(--color-font-label);
  }
</style>
