export type BackupType = 'daily' | 'event'
export type BackupTrigger = 'init' | 'interval' | 'event'

export interface BackupPathInfo {
  dir: string
  prefix: string
  filePath: (suffix: string) => string
}
