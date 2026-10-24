import _Event, { type EventType } from '@any-listen/nodejs/Event'

export class Event extends _Event {
  emitEvent<K extends keyof EventMethods>(eventName: K, ...args: unknown[]) {
    this.emit(eventName, ...args)
  }

  statusChanged(state: AnyListen.IPCSync.SyncState['webdav']) {
    this.emit('statusChanged', state)
  }
}

type EventMethods = Omit<Event, keyof _Event | 'emitEvent'>

export const syncWebDAVEvent = new Event() as EventType<Event>
