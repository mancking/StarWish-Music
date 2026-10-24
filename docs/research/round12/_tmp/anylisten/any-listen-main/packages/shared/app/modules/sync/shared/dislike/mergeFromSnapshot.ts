import { filterRules } from './shared'

export const mergeFullDataFromSnapshot = (localListData: string, latestListData: string, snapshotListData: string | null) => {
  const removedRules = new Set<string>()
  const localRules = filterRules(localListData)
  const latestRules = filterRules(latestListData)

  if (snapshotListData) {
    const snapshotRules = filterRules(snapshotListData)
    for (const m of snapshotRules.values()) {
      if (!localRules.has(m) || !latestRules.has(m)) removedRules.add(m)
    }
  }
  return Array.from(
    new Set(
      Array.from([...localRules, ...latestRules]).filter((rule) => {
        return !removedRules.has(rule)
      })
    )
  ).join('\n')
}
