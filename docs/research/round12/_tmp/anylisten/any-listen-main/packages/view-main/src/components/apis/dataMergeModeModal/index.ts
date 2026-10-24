import { mount, tick, unmount } from 'svelte'

import { onDesconnected } from '@/modules/app/shared'

import App from './App.svelte'

export const showDataMergeModeModal = async <T extends 'list' | 'dislike'>(
  syncType: T,
  hideRemoteOverwriteOption?: boolean
): Promise<T extends 'list' ? AnyListen.List.MergeMode : AnyListen.Dislike.MergeMode> => {
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
  }
  const unsub = onDesconnected(release)

  await tick()
  return (
    app.show(syncType, hideRemoteOverwriteOption) as Promise<
      T extends 'list' ? AnyListen.List.MergeMode : AnyListen.Dislike.MergeMode
    >
  ).finally(() => {
    unsub()
  })
}
