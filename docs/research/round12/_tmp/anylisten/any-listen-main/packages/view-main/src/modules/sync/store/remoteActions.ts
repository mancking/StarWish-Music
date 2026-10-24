import { webdavSyncStatusEvent } from '@/shared/ipc/sync/event'

import * as commit from './commit'

export { runSyncWebDAV, getSyncState } from '@/shared/ipc/sync'

export const registerRemoteActions = () => {
  return webdavSyncStatusEvent.on((state): void => {
    commit.setWebDAVSyncStatus(state)
  })
}
