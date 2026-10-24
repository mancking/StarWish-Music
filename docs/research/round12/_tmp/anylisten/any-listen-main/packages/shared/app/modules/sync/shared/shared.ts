export interface DeviceInfo {
  id: string
  name: string
  type: 'desktop' | 'mobile' | 'web'
  lastSyncTime: number
}

export type SnapshotList = string[]
export interface Client {
  snapshotKey: string
  lastSyncTime: number
}
export interface SnapshotInfo {
  version: number
  latest: string
  clients: Record<string, Client>
}
