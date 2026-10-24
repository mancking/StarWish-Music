import { sendDislikeAction } from '../../../dislikeList'
import { runSync } from '../../shared/dislike'
import { CONSTANTS } from '../shared'
import { is404Error, type WebDAV } from '../webdav'
import { decodeData, encodeData } from './shared'

const parseFile = async <T>(data?: string) => {
  if (!data) return null
  return JSON.parse(await decodeData(data)) as T
}
const buildFile = async <T>(data: T) => {
  return encodeData(JSON.stringify(data))
}
const checkDirectoryExists = async (webDAV: WebDAV) => {
  const checkDirs = [CONSTANTS.dislikeDirectoryName, `${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}`]
  for (const dir of checkDirs) {
    try {
      await webDAV.ls(dir)
    } catch (error) {
      if (!is404Error(error)) throw error
      await webDAV.mkdir(dir)
    }
  }
}
export const runSyncDislike = async (webDAV: WebDAV, onListMergeMode?: () => Promise<AnyListen.Dislike.MergeMode>) => {
  await runSync(
    {
      async getSnapshotInfo() {
        let snapshotInfoFile: string | undefined
        try {
          snapshotInfoFile = (await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotInfoFileName}`)).toString()
        } catch (error) {
          if (!is404Error(error)) throw error
          await checkDirectoryExists(webDAV)
        }
        return parseFile(snapshotInfoFile)
      },
      async saveSnapshotInfo(snapshotInfo) {
        const snapshotInfoFile = await buildFile(snapshotInfo)
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotInfoFileName}`, snapshotInfoFile)
      },
      async getSnapshotList() {
        let file: string | undefined
        try {
          file = (await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotListFileName}`)).toString()
        } catch (error) {
          if (!is404Error(error)) throw error
        }
        return (await parseFile(file)) ?? []
      },
      async saveSnapshotList(snapshotList) {
        const snapshotListFile = await buildFile(snapshotList)
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotListFileName}`, snapshotListFile)
      },
      async getSnapshotData(key) {
        let file: string | undefined
        try {
          file = (await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`)).toString()
        } catch (error) {
          if (!is404Error(error)) throw error
        }
        return file == null ? null : decodeData(file)
      },
      async removeSnapshot(key) {
        await webDAV.rm(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`).catch((error) => {
          if (!is404Error(error)) throw error
        })
      },
      async saveSnapshotData(key, data) {
        const snapshotDataFile = await encodeData(data)
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`, snapshotDataFile)
      },
      async overwriteLocalList(data) {
        await sendDislikeAction({ action: 'dislike_data_overwrite', data })
      },
    },
    onListMergeMode
  )
}
