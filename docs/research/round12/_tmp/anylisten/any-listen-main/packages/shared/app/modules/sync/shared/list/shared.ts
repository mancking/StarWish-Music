import type { SnapshotInfo } from '../shared'

export interface Options {
  getSnapshotInfo: () => Promise<SnapshotInfo | null>
  saveSnapshotInfo: (snapshotInfo: SnapshotInfo) => Promise<void>
  getSnapshotList: () => Promise<string[] | null>
  removeSnapshot: (key: string) => Promise<void>
  saveSnapshotList: (list: string[]) => Promise<void>
  getSnapshotData: (key: string) => Promise<AnyListen.List.ListDataFull | null>
  overwriteLocalList: (data: AnyListen.List.ListDataFull) => Promise<void>
  saveSnapshotData: (key: string, data: AnyListen.List.ListDataFull) => Promise<void>
}
