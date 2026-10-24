import { syncEvent } from './store/event'
import { syncState } from './store/state'

export const useSyncWebDAVState = () => {
  let val = $state.raw(syncState.webdav)

  $effect(() => {
    const handleUpdate = (state: AnyListen.IPCSync.SyncState['webdav']) => {
      val = state
    }
    handleUpdate(syncState.webdav)
    syncEvent.on('webdavSyncStatus', handleUpdate)

    return function stop() {
      syncEvent.off('webdavSyncStatus', handleUpdate)
    }
  })

  return {
    get val() {
      return val
    },
  }
}
