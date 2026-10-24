import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { rename } from 'node:fs/promises'
import path from 'node:path'

import { DAILY_BACKUP_KEEP_DAYS, EVENT_BACKUP_MAX_FILES, ONE_DAY_MS } from './constants'
import { parseBackupTimestampFromFileName } from './naming'
import type { BackupPathInfo } from './types'

export const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

export const removeFileIfExists = async (filePath: string) => {
  await fs.unlink(filePath).catch(() => {})
}

export const moveFile = async (fromPath: string, toPath: string) => {
  await rename(fromPath, toPath)
}

export const listBackupFiles = async (dir: string, prefix: string) => {
  const names = await fs.readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code == 'ENOENT') return [] as string[]
    throw error
  })
  return names.filter((name) => name.startsWith(prefix) && name.endsWith('.bak')).sort((a, b) => b.localeCompare(a))
}

export const hashFileSha256 = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('error', reject)
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}

export const ensureUniqueBackupPath = async (filePath: BackupPathInfo['filePath'], baseSuffix: string) => {
  let candidate = filePath(baseSuffix)
  let count = 0
  while (true) {
    try {
      await fs.access(candidate)
      count += 1
      candidate = filePath(`${baseSuffix}-${count}`)
    } catch {
      return candidate
    }
  }
}

export const pruneEventBackups = async (dir: string, prefix: string) => {
  const files = await listBackupFiles(dir, prefix)
  if (files.length <= EVENT_BACKUP_MAX_FILES) return

  const removeFiles = files.slice(EVENT_BACKUP_MAX_FILES)
  for (const name of removeFiles) {
    await fs.unlink(path.join(dir, name))
  }
}

export const pruneDailyBackups = async (dir: string, prefix: string) => {
  const files = await listBackupFiles(dir, prefix)
  if (!files.length) return

  const expireBefore = Date.now() - DAILY_BACKUP_KEEP_DAYS * ONE_DAY_MS
  for (const name of files) {
    const backupTime = parseBackupTimestampFromFileName(name, prefix)
    if (backupTime == null) continue
    if (backupTime < expireBefore) {
      await fs.unlink(path.join(dir, name))
    }
  }
}
