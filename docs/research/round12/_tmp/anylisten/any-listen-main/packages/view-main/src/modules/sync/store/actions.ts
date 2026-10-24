import * as commit from './commit'

export { setWebDAVSyncStatus } from './commit'

export { registerRemoteActions, getSyncState, runSyncWebDAV } from './remoteActions'

export const initSyncState = (state: AnyListen.IPCSync.SyncState) => {
  commit.setWebDAVSyncStatus(state.webdav)
}
