import { getSettings } from '../../../common'
import { runSyncWebDAV as runSync } from './sync'
import { runWebDAVSyncTask } from './task'

export const runSyncWebDAV: typeof runSync = async (options, syncOptions) => {
  return runSync(options, syncOptions).finally(() => {
    if (getSettings()['sync.webdav.enable']) {
      runWebDAVSyncTask()
    }
  })
}

export { cancelSyncWebDAV, getSyncWebDAVState, type SyncWebDAVOptions } from './sync'
