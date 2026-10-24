import { ipc } from '../ipc'

export const getSyncState: AnyListen.IPC.ServerIPC['getSyncState'] = async () => {
  return ipc.getSyncState()
}

export const runSyncWebDAV: AnyListen.IPC.ServerIPC['runSyncWebDAV'] = async (getListMergeMode, getDislikeMergeMode) => {
  return ipc.runSyncWebDAV(getListMergeMode, getDislikeMergeMode)
}
