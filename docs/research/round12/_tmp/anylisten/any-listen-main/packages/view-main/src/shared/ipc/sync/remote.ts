import { webdavSyncStatusEvent } from './event'

export default {
  async webdavSyncStatus(state) {
    webdavSyncStatusEvent.emit(state)
  },
} satisfies Partial<AnyListen.IPC.ClientIPC>
