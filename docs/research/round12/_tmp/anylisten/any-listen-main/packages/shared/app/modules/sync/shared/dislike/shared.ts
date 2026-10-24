import { SPLIT_CHAR } from '@any-listen/common/constants'

import type { SnapshotInfo } from '../shared'

export interface Options {
  getSnapshotInfo: () => Promise<SnapshotInfo | null>
  saveSnapshotInfo: (snapshotInfo: SnapshotInfo) => Promise<void>
  getSnapshotList: () => Promise<string[] | null>
  removeSnapshot: (key: string) => Promise<void>
  saveSnapshotList: (list: string[]) => Promise<void>
  getSnapshotData: (key: string) => Promise<string | null>
  overwriteLocalList: (data: string) => Promise<void>
  saveSnapshotData: (key: string, data: string) => Promise<void>
}

export const filterRules = (rules: string) => {
  const list: string[] = []
  for (const item of rules.split('\n')) {
    if (!item) continue
    let [name, singer] = item.split(SPLIT_CHAR.DISLIKE_NAME)
    if (name) {
      name = name.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      if (singer) {
        singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
        list.push(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
      } else {
        list.push(name)
      }
    } else if (singer) {
      singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      list.push(`${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
    }
  }
  return new Set(list)
}
