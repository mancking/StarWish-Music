<script lang="ts">
  import { i18n, t } from '@/plugins/i18n'
  import TitleContent from '../../components/TitleContent.svelte'
  import Btn from '@/components/base/Btn.svelte'
  import { showSimpleConfirmModal } from '@/components/apis/dialog'
  import { exportData, showOpenDialog, showSaveDialog } from '@/shared/ipc/app'
  import { showNotify } from '@/components/apis/notify'

  const exportPlayListToText = async (savePath: string, isMerge: boolean) => {
    // const lists = await getAllLists()
    // await window.lx.worker.main.exportPlayListToText(savePath, lists, isMerge)
    try {
      await exportData(savePath, [isMerge ? 'txt_all' : 'txt'])
      showNotify(i18n.t('settings.backup.export_success'))
    } catch (err) {
      console.error(err)
      showNotify(i18n.t('settings.backup.export_failed', { err: err instanceof Error ? err.message : String(err) }))
    }
  }
  const handleExportPlayListToText = async () => {
    const confirm = await showSimpleConfirmModal(i18n.t('settings.backup.export_text_confirm'), {
      cancelBtn: i18n.t('cancel_button_text'),
      confirmBtn: i18n.t('confirm_button_text'),
    })
    if (confirm) {
      void showSaveDialog({
        title: i18n.t('settings.backup.save_dir'),
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
        defaultFileName: 'any-listen_list_all.txt',
      }).then((result) => {
        if (result.canceled) return
        let path = result.filePath
        if (!path.endsWith('.txt')) path += '.txt'
        void exportPlayListToText(path, true)
      })
    } else {
      void showOpenDialog({
        title: i18n.t('settings.backup.save_dir'),
        // defaultPath: currentStting.value.download.savePath,
        properties: ['openDirectory'],
      }).then((result) => {
        if (result.canceled) return
        void exportPlayListToText(result.filePaths[0], false)
      })
    }
  }

  const exportPlayListToCsv = async (savePath: string, isMerge: boolean) => {
    // const lists = await getAllLists()
    // await window.lx.worker.main.exportPlayListToCSV(
    //   savePath,
    //   lists,
    //   isMerge,
    //   `${t('music_name')},${t('music_singer')},${t('music_album')}\n`
    // )
    try {
      await exportData(savePath, [isMerge ? 'csv_all' : 'csv'])
      showNotify(i18n.t('settings.backup.export_success'))
    } catch (err) {
      console.error(err)
      showNotify(i18n.t('settings.backup.export_failed', { err: err instanceof Error ? err.message : String(err) }))
    }
  }
  const handleExportPlayListToCsv = async () => {
    const confirm = await showSimpleConfirmModal(i18n.t('settings.backup.export_text_confirm'), {
      cancelBtn: i18n.t('cancel_button_text'),
      confirmBtn: i18n.t('confirm_button_text'),
    })
    if (confirm) {
      void showSaveDialog({
        title: i18n.t('settings.backup.save_dir'),
        defaultFileName: 'any-listen_list_all.csv',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      }).then((result) => {
        if (result.canceled) return
        let path = result.filePath
        if (!path.endsWith('.csv')) path += '.csv'
        void exportPlayListToCsv(path, true)
      })
    } else {
      void showOpenDialog({
        title: i18n.t('settings.backup.save_dir'),
        // defaultPath: currentStting.value.download.savePath,
        properties: ['openDirectory'],
      }).then((result) => {
        if (result.canceled) return
        void exportPlayListToCsv(result.filePaths[0], false)
      })
    }
  }
</script>

<TitleContent name={$t('settings.backup.export_other')} desc={$t('settings.backup.export_other_desc')}>
  <div class="settings-item-content">
    <Btn min onclick={handleExportPlayListToText}>
      {$t('settings.backup.text')}
    </Btn>
    <Btn min onclick={handleExportPlayListToCsv}>
      {$t('settings.backup.csv')}
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
