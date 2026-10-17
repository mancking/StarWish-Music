import fs from 'node:fs'
import path from 'node:path'
import { logDir } from './paths'

/** 轻量文件日志：避免第三方依赖，按天切分，最多保留 7 个文件 */
const MAX_FILES = 7
let stream: fs.WriteStream | null = null
let currentDay = ''
let errorCount = 0

function dayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ensureStream(): fs.WriteStream | null {
  const day = dayKey()
  if (stream && currentDay === day) return stream
  try {
    if (stream) stream.end()
    const file = path.join(logDir(), `starwish-${day}.log`)
    stream = fs.createWriteStream(file, { flags: 'a' })
    currentDay = day
    prune()
    return stream
  } catch {
    return null
  }
}

function prune(): void {
  try {
    const dir = logDir()
    const files = fs
      .readdirSync(dir)
      .filter(f => /^starwish-.*\.log$/.test(f))
      .sort()
    while (files.length > MAX_FILES) {
      const f = files.shift()!
      fs.unlinkSync(path.join(dir, f))
    }
  } catch {
    /* ignore */
  }
}

function write(level: string, scope: string, args: unknown[]): void {
  const msg = args
    .map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(' ')
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${msg}\n`
  const s = ensureStream()
  if (s) s.write(line)
  if (level === 'ERROR') errorCount++
  if (process.env.STARWISH_DEBUG || !process.env.STARWISH_QUIET) {
    const fn = level === 'ERROR' ? console.error : console.log
    fn(line.trimEnd())
  }
}

export function createLogger(scope: string) {
  return {
    info: (...a: unknown[]) => write('INFO', scope, a),
    warn: (...a: unknown[]) => write('WARN', scope, a),
    error: (...a: unknown[]) => write('ERROR', scope, a),
    debug: (...a: unknown[]) => {
      if (process.env.STARWISH_DEBUG) write('DEBUG', scope, a)
    },
  }
}

export function getErrorCount(): number {
  return errorCount
}

export const log = createLogger('app')
