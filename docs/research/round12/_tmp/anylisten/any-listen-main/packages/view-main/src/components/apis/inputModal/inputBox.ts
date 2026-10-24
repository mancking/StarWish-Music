import { mount, tick, unmount } from 'svelte'

import { onDesconnected } from '@/modules/app/shared'
import { closeMessageBoxEvent } from '@/shared/ipc/app/event'

import App from './App.svelte'

export const showInputBox = async (
  options: AnyListen.IPCCommon.InputDialogOptions,
  key?: string,
  extId?: string
): Promise<string> => {
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
  return (app.show(options, extId) as Promise<string>).finally(() => {
    key = ''
    unsub()
    unsub2()
  })
}
