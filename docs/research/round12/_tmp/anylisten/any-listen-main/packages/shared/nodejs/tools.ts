import { unlink } from 'node:fs/promises'
import path from 'node:path'

import { DB_NAME } from '@any-listen/common/constants'

import { toMD5 } from '.'

export const removeDB = async (dataPath: string) => {
  const dbPath = path.join(dataPath, DB_NAME)
  try {
    await Promise.all([unlink(dbPath), unlink(`${dbPath}-wal`), unlink(`${dbPath}-shm`)])
  } catch {}
}

export const getListDataMD5 = (listData: AnyListen.List.ListDataFull) => {
  return toMD5(JSON.stringify(listData))
}

export const getDefaultAutoBackupPath = (appDataPath: string) => {
  return path.join(appDataPath, 'backup')
}
