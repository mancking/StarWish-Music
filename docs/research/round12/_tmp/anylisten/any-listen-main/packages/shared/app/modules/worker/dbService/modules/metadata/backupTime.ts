import { dbPrepare } from '../../db'

const LAST_BACKUP_TIME_FIELD = 'last_backup_time'

export const queryMetadataLastBackupTime = () => {
  const result = dbPrepare<[string], { field_value: string }>(`
    SELECT "field_value"
    FROM "main"."metadata"
    WHERE "field_name"=?
  `).get(LAST_BACKUP_TIME_FIELD)

  if (!result) return 0

  const time = parseInt(result.field_value, 10)
  return Number.isNaN(time) ? 0 : time
}

export const saveMetadataLastBackupTime = (time: number) => {
  dbPrepare<[string, string]>(`
    INSERT INTO "main"."metadata" ("field_name", "field_value")
    VALUES (?, ?)
  `).run(LAST_BACKUP_TIME_FIELD, String(time))
}
