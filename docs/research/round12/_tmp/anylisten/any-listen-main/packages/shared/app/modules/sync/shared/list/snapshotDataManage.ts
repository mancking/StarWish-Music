import { getListDataMD5 } from '@any-listen/nodejs/tools'

import type { SnapshotInfo } from '../shared'
import type { Options } from './shared'

export class SnapshotDataManage {
  private readonly options: Options
  private snapshotInfo: SnapshotInfo = {
    version: 1,
    latest: '',
    clients: {},
  }
  private snapshotList: string[] = []
  static MAX_SNAPSHOT_NUM = 30
  private inited = false

  constructor(options: Options) {
    this.options = options
  }

  init = async (snapshotInfo?: SnapshotInfo | null) => {
    if (this.inited) return
    const [_snapshotInfo, snapshotList] = await Promise.all([
      snapshotInfo ? Promise.resolve(snapshotInfo) : this.options.getSnapshotInfo(),
      this.options.getSnapshotList(),
    ])
    if (_snapshotInfo) this.snapshotInfo = _snapshotInfo
    if (snapshotList) this.snapshotList = snapshotList
    this.inited = true
  }

  clearOldSnapshot = async () => {
    await this.init()
    if (this.snapshotList.length <= SnapshotDataManage.MAX_SNAPSHOT_NUM) return false
    const excludedSet = new Set<string>()
    for (const client of Object.values(this.snapshotInfo.clients)) {
      excludedSet.add(client.snapshotKey)
    }
    const removedKeys: string[] = []
    for (let i = this.snapshotList.length - 1; i > SnapshotDataManage.MAX_SNAPSHOT_NUM - 1; i--) {
      const key = this.snapshotList[i]
      if (!excludedSet.has(key)) {
        removedKeys.push(key)
        this.snapshotList.splice(i, 1)
      }
    }

    if (!removedKeys.length) return false
    await this.options.saveSnapshotList(this.snapshotList)
    for (const key of removedKeys) await this.options.removeSnapshot(key)
    return true
  }

  saveSnapshotData = async (deviceId: string, snapshotData: AnyListen.List.ListDataFull) => {
    await this.init()
    const md5 = getListDataMD5(snapshotData)
    this.snapshotInfo.latest = md5
    this.snapshotInfo.clients[deviceId] = {
      snapshotKey: md5,
      lastSyncTime: Date.now(),
    }
    const idx = this.snapshotList.indexOf(md5)
    if (idx == -1) {
      await this.options.saveSnapshotData(md5, snapshotData)
    } else {
      this.snapshotList.splice(idx, 1)
    }
    await this.options.saveSnapshotInfo(this.snapshotInfo)
    this.snapshotList.unshift(md5)
    const updated = await this.clearOldSnapshot()
    if (!updated) await this.options.saveSnapshotList(this.snapshotList)
  }
}
