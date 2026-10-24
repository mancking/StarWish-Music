import _Event, { type EventType } from '@any-listen/web/Event'

class Event extends _Event {
  emitEvent<K extends keyof EventMethods>(eventName: K, ...args: unknown[]) {
    this.emit(eventName, ...args)
  }

  webdavSyncStatus(state: AnyListen.IPCSync.SyncState['webdav']) {
    this.emitEvent('webdavSyncStatus', state)
  }
}

type EventMethods = Omit<Event, keyof _Event | 'emitEvent'>

export const syncEvent = new Event() as EventType<Event>
