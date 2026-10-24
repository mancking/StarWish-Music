import SingleEvent from '@any-listen/web/SimpleSingleEvent'

export const webdavSyncStatusEvent = new SingleEvent<[state: AnyListen.IPCSync.SyncState['webdav']]>()
