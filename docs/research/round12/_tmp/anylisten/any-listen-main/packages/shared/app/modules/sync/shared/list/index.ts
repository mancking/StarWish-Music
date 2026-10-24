import { buildListDataFull } from '@any-listen/common/tools'
import { getListDataMD5 } from '@any-listen/nodejs/tools'

import { getSettings } from '../../../../common'
import { getDeviceId } from '../../../../common/deviceId'
import { workers } from '../../../worker'
import type { Client } from '../shared'
import { mergeFullData } from './merge'
import { mergeFullDataFromSnapshot } from './mergeFromSnapshot'
import type { Options } from './shared'
import { SnapshotDataManage } from './snapshotDataManage'

export const runSync = async (options: Options, getListMergeMode?: () => Promise<AnyListen.List.MergeMode>) => {
  const snapshotInfo = await options.getSnapshotInfo()
  if (snapshotInfo?.latest) {
    const deviceId = getDeviceId()
    const client = snapshotInfo.clients[deviceId] as Client | undefined
    if (client?.snapshotKey) {
      const localKey = await workers.dbService.getAllListDataMD5()
      console.log('keys', localKey, snapshotInfo.latest, client.snapshotKey)
      if (localKey === snapshotInfo.latest) {
        if (localKey === client.snapshotKey) return
        client.snapshotKey = localKey
        client.lastSyncTime = Date.now()
        await options.saveSnapshotInfo(snapshotInfo)
        const snapshotDataManage = new SnapshotDataManage(options)
        await snapshotDataManage.init(snapshotInfo)
        await snapshotDataManage.clearOldSnapshot()
        return
      }
      if (localKey === client.snapshotKey) {
        const latestSnapshotData = await options.getSnapshotData(snapshotInfo.latest)
        // TODO: If the latest snapshot data is not available
        if (!latestSnapshotData) throw new Error('Latest snapshot data not found')
        await options.overwriteLocalList(latestSnapshotData)
        const snapshotDataManage = new SnapshotDataManage(options)
        await snapshotDataManage.init(snapshotInfo)
        await snapshotDataManage.saveSnapshotData(deviceId, latestSnapshotData)
        return
      }
      const [latestData, snapshotData, localListData] =
        snapshotInfo.latest == client.snapshotKey
          ? await Promise.all([options.getSnapshotData(snapshotInfo.latest), workers.dbService.getAllListData()]).then(
              ([latestData, localListData]) => [latestData, latestData, localListData] as const
            )
          : await Promise.all([
              options.getSnapshotData(snapshotInfo.latest),
              options.getSnapshotData(client.snapshotKey),
              workers.dbService.getAllListData(),
            ])
      // TODO: If the latest snapshot data or the snapshot data is not available
      if (!latestData || !snapshotData) throw new Error('Snapshot data not found')
      const newData = mergeFullDataFromSnapshot(
        localListData,
        latestData,
        snapshotData,
        getSettings()['list.addMusicLocationType']
      )
      await options.overwriteLocalList(newData)

      const localKey2 = await workers.dbService.getAllListDataMD5()
      const md5 = getListDataMD5(snapshotData)
      console.log(localKey, localKey2, md5)
      const snapshotDataManage = new SnapshotDataManage(options)
      await snapshotDataManage.init(snapshotInfo)
      await snapshotDataManage.saveSnapshotData(deviceId, newData)
      return
    }
    if (getListMergeMode) {
      // const mergeMode = await getListMergeMode()
      // if (mergeMode === 'cancel') return
      const [latestData, localListData] = await Promise.all([
        options.getSnapshotData(snapshotInfo.latest),
        workers.dbService.getAllListData(),
      ])
      // TODO: If the latest data is not available
      if (!latestData) throw new Error('Snapshot data not found')
      let [mergedList, requiredUpdateLocalListData] = await mergeFullData(
        localListData,
        latestData,
        getSettings()['list.addMusicLocationType'],
        getListMergeMode,
        async () => workers.dbService.getAllListData()
      )
      mergedList = buildListDataFull(mergedList)
      if (requiredUpdateLocalListData) await options.overwriteLocalList(mergedList)
      const snapshotDataManage = new SnapshotDataManage(options)
      await snapshotDataManage.init(snapshotInfo)
      await snapshotDataManage.saveSnapshotData(deviceId, mergedList)
      return
    }
    throw new Error('Local list data is different from the latest snapshot data, but no merge mode is provided')
  }
  const localListData = await workers.dbService.getAllListData()
  const snapshotDataManage = new SnapshotDataManage(options)
  await snapshotDataManage.init(snapshotInfo)
  await snapshotDataManage.saveSnapshotData(getDeviceId(), localListData)
}
