import { onRelease } from '@/modules/app/shared'
import { settingEvent } from '@/modules/setting/store/event'
import { createUnsubscriptionSet } from '@/shared'

import { registerRemoteActions, getSyncState, initSyncState } from './store/actions'

const init = async () => {
  initSyncState(await getSyncState())
}

const unregistered = createUnsubscriptionSet()
export const initSync = () => {
  onRelease(unregistered.clear.bind(unregistered))
  settingEvent.on('inited', () => {
    unregistered.register((subscriptions) => {
      subscriptions.add(registerRemoteActions())
    })
    void init()
  })
}
