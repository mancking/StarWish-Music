import { syncEvent } from './event'
import { syncState } from './state'

export const setWebDAVSyncStatus = (state: AnyListen.IPCSync.SyncState['webdav']) => {
  syncState.webdav.status = state.status
  syncState.webdav.error = state.error
  syncState.webdav.nextSyncTime = state.nextSyncTime
  syncEvent.webdavSyncStatus(state)
}
