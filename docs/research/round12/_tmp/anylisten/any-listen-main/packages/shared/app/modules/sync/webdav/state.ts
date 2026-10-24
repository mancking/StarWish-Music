export const state = {
  cancelTask: undefined as (() => void) | undefined,
  status: 'idle' as AnyListen.IPCSync.SyncStatus,
  error: undefined as Error | undefined,
  nextSyncTime: 0,
}
