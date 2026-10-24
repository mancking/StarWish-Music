import { BACKUP_HOUR } from './constants'

const getNextBackupDelay = () => {
  const now = new Date()
  const next = new Date(now)
  next.setHours(BACKUP_HOUR, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export const scheduleDailyBackup = (run: () => Promise<void>) => {
  const delay = getNextBackupDelay()
  setTimeout(() => {
    void run().finally(() => {
      scheduleDailyBackup(run)
    })
  }, delay)
}

export const isSameDay = (timeA: number, timeB: number) => {
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return false

  const a = new Date(timeA)
  const b = new Date(timeB)
  return a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate()
}
