import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from './paths'

/**
 * 启动阶段追踪。
 *
 * 目的：用户反馈「双击没反应 / 有进程没窗口」时，普通日志只能看到「启动完成」，
 * 无法区分是卡在数据库、音源加载、窗口创建还是首帧合成。这里记录每个阶段的
 * 时间戳，配合 `--diagnose` 参数落盘成 boot-trace.json，让问题可定位。
 *
 * 收集本身开销可忽略（只 push 对象），默认不写文件，避免每次启动都产生垃圾。
 */

interface TraceItem {
  stage: string
  at: number
  delta: number
  note?: string
}

const startedAt = Date.now()
const items: TraceItem[] = []
let lastAt = startedAt

/** 记录一个启动阶段。delta 为距上一阶段的毫秒数，便于一眼看出卡在哪。 */
export function trace(stage: string, note?: string): void {
  const now = Date.now()
  items.push({ stage, at: now, delta: now - lastAt, note })
  lastAt = now
}

export function isDiagnoseMode(): boolean {
  return process.argv.includes('--diagnose') || process.env.STARWISH_DIAGNOSE === '1'
}

export function traceFilePath(): string {
  return path.join(userDataDir(), 'boot-trace.json')
}

/**
 * 写出诊断文件。仅在诊断模式下调用；返回文件路径，失败返回 null。
 * 额外信息（数据目录、GPU 状态、降级级别、平台）一并写入，方便远程判断。
 */
export function writeBootTrace(extra: Record<string, unknown> = {}): string | null {
  if (!isDiagnoseMode()) return null
  try {
    const payload = {
      version: process.env.npm_package_version || '',
      platform: process.platform,
      arch: process.arch,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      argv: process.argv.slice(1),
      totalMs: Date.now() - startedAt,
      stages: items,
      ...extra,
    }
    const p = traceFilePath()
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
    return p
  } catch {
    return null
  }
}
