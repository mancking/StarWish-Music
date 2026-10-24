import { mount, tick, unmount } from 'svelte'

import { onDesconnected } from '@/modules/app/shared'
import { closeMessageBoxEvent } from '@/shared/ipc/app/event'

import App from './App.svelte'

export const showBackupTypeSelectModal = async (
  mode: 'export' | 'import' = 'export',
  availableTypes?: AnyListen.BackupType[],
  key?: string
): Promise<AnyListen.BackupType[]> => {
  const app = mount(App, {
    target: document.getElementById('root')!,
    props: {
      onafterleave() {
        void unmount(app, { outro: true })
      },
    },
  })
  const release = () => {
    app.hide()
    unsub()
    unsub2()
  }
  const unsub = onDesconnected(release)
  const unsub2 = key
    ? closeMessageBoxEvent.on((_key) => {
        if (key != _key) return
        release()
      })
    : () => {}
  await tick()
  return (app.show(mode, availableTypes) as Promise<AnyListen.BackupType[]>).finally(() => {
    key = ''
    unsub()
    unsub2()
  })
}
