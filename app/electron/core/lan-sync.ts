import http from 'node:http'
import os from 'node:os'
import { app } from 'electron'

/**
 * 局域网同步
 *
 * 桌面宿主：Electron 主进程内嵌 http 服务（默认 :42717），
 *  - GET  /lan/ping   → 能力通告（设备发现用 IP 直连，WebView 不解析 .local）
 *  - POST /lan/pair   → 6 位 PIN 配对（配对成功返回会话 token）
 *  - POST /lan/sync   → 增量同步（LWW：收藏/播放历史/设置子集，按时间戳取新者）
 * 移动端/车机：手输 桌面IP:端口 + PIN（bridge lan:pair / lan:sync / lan:pull）。
 * 不同步音频文件本体（曲库另走下载/缓存，规格 4.8 同步通道划分）。
 */
import { addHistory, favoriteIds, favoriteSongs, getSong, run, all, get } from './db'
import { getSettings, saveSettings } from './settings'
import { createLogger } from './log'

const logger = createLogger('lan-sync')
const PORT = 42717

export interface SyncRecord {
  /** 形如 wy:123456 */
  songId: string
  at: number
  deleted?: boolean
  song?: any
}

let server: http.Server | null = null
let pin = ''
let pairedTokens = new Set<string>()
let lastSyncAt = 0

export function lanSyncActive(): boolean {
  return !!server
}

export function lanSyncInfo(): { active: boolean; port: number; pin: string; ips: string[]; lastSyncAt: number } {
  return { active: lanSyncActive(), port: PORT, pin: lanSyncActive() ? pin : '', ips: lanSyncActive() ? lanIps() : [], lastSyncAt }
}

function lanIps(): string[] {
  const out: string[] = []
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const it of ifs || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address)
    }
  }
  return out
}

function newPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise(resolve => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8')
      if (data.length > 8 * 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function tokenOf(pinCode: string): string {
  return `${pinCode}-${new Date().toDateString()}`
}

/** LWW 合并：按 record.at 取新者；deleted 为墓碑（4.8 ④） */
function mergeRecords(remote: SyncRecord[], local: Map<string, { at: number; deleted?: boolean }>, apply: (r: SyncRecord) => void): number {
  let n = 0
  for (const r of remote || []) {
    if (!r?.songId || typeof r.at !== 'number') continue
    const cur = local.get(r.songId)
    if (!cur || r.at > cur.at) {
      apply(r)
      local.set(r.songId, { at: r.at, deleted: r.deleted })
      n++
    }
  }
  return n
}

async function handleSync(body: any): Promise<any> {
  const favLocal = new Map<string, { at: number; deleted?: boolean }>()
  for (const id of favoriteIds()) {
    const row = get('SELECT added_at FROM favorites WHERE song_id = ?', [id]) as any
    favLocal.set(id, { at: Number(row?.added_at) || 0 })
  }
  const histLocal = new Map<string, { at: number; deleted?: boolean }>()
  for (const r of all<{ id: string; at: number }>('SELECT song_id AS id, MAX(played_at) AS at FROM play_history GROUP BY song_id', [])) {
    histLocal.set(r.id, { at: r.at })
  }

  let appliedFav = 0
  let appliedHist = 0
  for (const r of body.favorites || []) {
    if (typeof r.songId !== 'string' || typeof r.at !== 'number') continue
    const cur = favLocal.get(r.songId)
    if (!cur || r.at > cur.at) {
      if (r.deleted) {
        run('DELETE FROM favorites WHERE song_id = ?', [r.songId])
      } else {
        const song = r.song || getSong(r.songId)
        if (song?.id) {
          run('DELETE FROM favorites WHERE song_id = ?', [r.songId])
          run('INSERT INTO favorites (song_id, added_at) VALUES (?,?)', [r.songId, r.at])
          if (!getSong(r.songId)) {
            // 远端歌曲本机没有：补进曲库表
            const s = r.song
            run(
              `INSERT OR REPLACE INTO songs (id, source, song_id, name, singer, album, duration, pic, local_path, qualitys, extra, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              [s.id, s.source || '', s.songId || '', s.name || '', s.singer || '', s.album || '', s.duration || 0, s.pic || '', '', '', JSON.stringify(s.extra || {}), Date.now()]
            )
          }
        }
      }
      favLocal.set(r.songId, { at: r.at, deleted: r.deleted })
      appliedFav++
    }
  }
  for (const r of body.history || []) {
    if (typeof r.songId !== 'string' || typeof r.at !== 'number' || r.deleted) continue
    const cur = histLocal.get(r.songId)
    if (!cur || r.at > cur.at) {
      const song = r.song || getSong(r.songId)
      if (song?.id) {
        run('INSERT INTO play_history (song_id, played_at, ms) VALUES (?,?,?)', [r.songId, r.at, 0])
        if (!getSong(r.songId)) {
          const s = r.song
          run(
            `INSERT OR REPLACE INTO songs (id, source, song_id, name, singer, album, duration, pic, local_path, qualitys, extra, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [s.id, s.source || '', s.songId || '', s.name || '', s.singer || '', s.album || '', s.duration || 0, s.pic || '', '', '', JSON.stringify(s.extra || {}), Date.now()]
          )
        }
      }
      histLocal.set(r.songId, { at: r.at })
      appliedHist++
    }
  }

  // 设置子集（theme/accent/quality/playMode/eq）：对端更新者胜
  const s = body.settings || {}
  const patch: Record<string, any> = {}
  for (const k of ['theme', 'accent', 'accentMode', 'quality', 'playMode', 'eqPreset', 'eqBands']) {
    if (s[k] !== undefined && s[k] !== (getSettings() as any)[k]) patch[k] = s[k]
  }
  if (Object.keys(patch).length) saveSettings(patch as any)

  lastSyncAt = Date.now()
  // 返回宿主数据（客户端合并，双向一次往返）
  return {
    ok: true,
    applied: { favorites: appliedFav, history: appliedHist, settings: Object.keys(patch).length },
    favorites: favoriteSongs().map((song: any) => ({ songId: song.id, at: favLocal.get(song.id)?.at || Date.now(), song })),
    history: all<{ song_id: string; at: number }>(
      'SELECT song_id, MAX(played_at) AS at FROM play_history GROUP BY song_id ORDER BY at DESC LIMIT 200',
      []
    ).map(r => ({ songId: r.song_id, at: r.at, song: getSong(r.song_id) || undefined })),
    settings: {
      theme: getSettings().theme,
      accent: getSettings().accent,
      accentMode: getSettings().accentMode,
      quality: getSettings().quality,
      playMode: getSettings().playMode,
      eqPreset: (getSettings() as any).eqPreset,
      eqBands: (getSettings() as any).eqBands,
    },
  }
}

export function startLanSync(): Promise<{ ok: boolean; port: number; pin: string; ips: string[] }> {
  if (server) return Promise.resolve({ ok: true, port: PORT, pin, ips: lanIps() })
  pin = newPin()
  pairedTokens = new Set()
  return new Promise(resolve => {
    const srv = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const url = (req.url || '').split('?')[0]!
      try {
        if (req.method === 'GET' && url === '/lan/ping') {
          res.end(JSON.stringify({ ok: true, app: 'starwish', version: app.getVersion(), pinRequired: true }))
          return
        }
        const body = await readBody(req)
        if (req.method === 'POST' && url === '/lan/pair') {
          if (String(body.pin) === pin) {
            const token = tokenOf(pin)
            pairedTokens.add(token)
            res.end(JSON.stringify({ ok: true, token }))
          } else {
            res.statusCode = 403
            res.end(JSON.stringify({ ok: false, error: '配对码不正确' }))
          }
          return
        }
        if (req.method === 'POST' && url === '/lan/sync') {
          if (!pairedTokens.has(String(body.token || ''))) {
            res.statusCode = 401
            res.end(JSON.stringify({ ok: false, error: '未配对' }))
            return
          }
          const result = await handleSync(body)
          res.end(JSON.stringify(result))
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'not found' }))
      } catch (e: any) {
        logger.warn('LAN 同步请求失败', e?.message)
        res.statusCode = 500
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
      }
    })
    srv.on('error', (e: any) => {
      logger.warn('LAN 同步服务启动失败', e?.message)
      server = null
      resolve({ ok: false, port: PORT, pin: '', ips: [] })
    })
    srv.listen(PORT, '0.0.0.0', () => {
      server = srv
      logger.info('LAN 同步宿主已启动', `:${PORT}`, 'PIN', pin)
      resolve({ ok: true, port: PORT, pin, ips: lanIps() })
    })
  })
}

export function stopLanSync(): void {
  try {
    server?.close()
  } catch {
    /* ignore */
  }
  server = null
}
