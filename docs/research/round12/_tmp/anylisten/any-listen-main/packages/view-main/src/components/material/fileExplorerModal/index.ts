import { mount, tick, unmount } from 'svelte'

import type { FileExplorerOptions, FileSaveOptions } from './shared'

export const showFileExplorerModal = async (options: FileExplorerOptions) => {
  const App = (await import('./Open.svelte')).default

  return new Promise<AnyListen.OpenDialogResult>((resolve, reject) => {
    const app = mount(App, {
      target: document.getElementById('root')!,
      props: {
        onafterleave() {
          void unmount(app, { outro: true })
        },
        onsubmit(result: AnyListen.OpenDialogResult) {
          resolve(result)
        },
      },
    })
    void tick().then(() => {
      app.show(options)
    })
  })
}

export const showFileSaveModal = async (options: FileSaveOptions) => {
  const App = (await import('./Save.svelte')).default

  return new Promise<AnyListen.SaveDialogResult>((resolve, reject) => {
    const app = mount(App, {
      target: document.getElementById('root')!,
      props: {
        onafterleave() {
          void unmount(app, { outro: true })
        },
        onsubmit(result: AnyListen.SaveDialogResult) {
          resolve(result)
        },
      },
    })
    void tick().then(() => {
      app.show(options)
    })
  })
}
