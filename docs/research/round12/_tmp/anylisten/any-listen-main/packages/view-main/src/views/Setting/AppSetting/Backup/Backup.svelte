<script lang="ts">
  import { i18n, t } from '@/plugins/i18n'
  import TitleContent from '../../components/TitleContent.svelte'
  import Btn from '@/components/base/Btn.svelte'
  import { showOpenDialog, showSaveDialog, exportData, importData } from '@/shared/ipc/app'
  import { CANCELED_ERROR_MSG, CONFIG_FILE_EXT } from '@any-listen/common/constants'
  import { showDataMergeModeModal } from '@/components/apis/dataMergeModeModal'
  import { showBackupTypeSelectModal } from './typeSelectModal'
  import { showNotify } from '@/components/apis/notify'

  const isCanceledError = (err: unknown) => {
    return err instanceof Error && err.message === CANCELED_ERROR_MSG
  }

  const handleExportData = async () => {
    const types = await showBackupTypeSelectModal('export').catch((err) => {
      console.error(err)
      return null
    })
    if (!types?.length) return

    const result = await showSaveDialog({
      title: i18n.t('settings.backup.save_dir'),
      defaultFileName: `any-listen.backup${CONFIG_FILE_EXT}`,
      filters: [{ name: 'Any Listen Backup File', extensions: [CONFIG_FILE_EXT.slice(1)] }],
    })
    if (result.canceled) return
    try {
      await exportData(result.filePath, types)
      showNotify(i18n.t('settings.backup.export_success'))
    } catch (err) {
      console.error(err)
      showNotify(i18n.t('settings.backup.export_failed', { err: err instanceof Error ? err.message : String(err) }))
    }
  }

  const handleSelectImportFile = async () => {
    const result = await showOpenDialog({
      title: i18n.t('settings.backup.restore_file'),
      filters: [{ name: 'Any Listen Backup File', extensions: [CONFIG_FILE_EXT.slice(1), 'json'] }],
      properties: ['openFile'],
    })
    if (result.canceled) return
    await handleImportData(result.filePaths[0])
  }
  const handleImportData = async (path: string) => {
    let selectedTypes: AnyListen.BackupType[] = []
    try {
      await importData(
        path,
        async (types) => {
          selectedTypes = await showBackupTypeSelectModal('import', types)
          return selectedTypes
        },
        async () => {
          if (!selectedTypes.includes('songlist')) return 'cancel'
          return showDataMergeModeModal('list', true)
        }
      )
      showNotify(i18n.t('settings.backup.import_success'))
    } catch (err) {
      if (isCanceledError(err)) return
      console.error(err)
      showNotify(i18n.t('settings.backup.import_failed', { err: err instanceof Error ? err.message : String(err) }))
    }
  }
</script>

<TitleContent name={$t('settings.backup')}>
  <div class="settings-item-content">
    <Btn min onclick={handleExportData}>
      {$t('settings.backup.export')}
    </Btn>
    <Btn min onclick={handleSelectImportFile}>
      {$t('settings.backup.import')}
    </Btn>
  </div>
</TitleContent>

<style lang="less">
  .settings-item-content {
    display: flex;
    flex-flow: row wrap;
    gap: 15px;
  }
</style>
