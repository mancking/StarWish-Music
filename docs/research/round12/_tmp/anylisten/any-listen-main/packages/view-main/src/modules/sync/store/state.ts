export interface InitState {
  webdav: {
    status: AnyListen.IPCSync.SyncStatus
    nextSyncTime: number
    error?: string
  }
}

export const syncState: InitState = {
  webdav: {
    status: 'idle',
    nextSyncTime: 0,
  },
}
