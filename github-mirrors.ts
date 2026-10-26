/**
 * 统一 GitHub raw 镜像池（单一事实来源）
 *
 * 市场清单 / 插件脚本 / 音源 URL 导入 / 订阅源共用此池，
 * 避免各宿主各自维护一份镜像列表（相互重复且各自过期）。
 *
 * 选池依据（2026-10-26 本机网络实测 + 社区 2026-10-25 实测）：
 *  - 主力：jsDelivr 官方多 CDN 中国节点（fastly / testingcf / quantil / gcore / b-cdn / jsdmirror）
 *  - 代理拼接第二梯队：gh-proxy.com / ghproxy.net / gh.llkk.cc / ghfast.top / cdn.jsdelivr.net
 *  - 已确认失效并移除：ghproxy.com、mirror.ghproxy.com（已关停）；raw.gitmirror.com、
 *    raw.githubusercdn.com、raw.staticdn.net、raw.githubusercontents.com（DNS 失效）；
 *    github.moeyy.xyz、ghproxy.cc（已关停）；TUNA github-raw（非白名单仓库返回 403）
 *  - 个人自建站（tvv.tw / ghm.078465.xyz 等）不收录：无 hash 校验的场景存在内容被篡改风险
 *
 * 通道内增强：
 *  - 健康记忆：镜像失败进入冷却期（连续失败指数退避 1min→10min），弱网下不再反复等超时
 *  - 动态优先：最近一次成功延迟短的镜像排前，竞速先启动快镜像
 */

import { request } from './http'

export interface RawParts {
  proto: string
  owner: string
  repo: string
  branch: string
  filePath: string
}

/** 解析 raw.githubusercontent.com（或 github.com/blob）直链为结构化路径 */
export function parseRaw(url: string): RawParts | null {
  const m = /^(https?):\/\/(raw\.githubusercontent\.com|github\.com)\/([^/]+)\/([^/]+)\/((?:blob\/)?([^/]+)\/(.+)|.+)$/i.exec(url)
  if (!m) return null
  return {
    proto: m[1] || 'https',
    owner: m[3],
    repo: m[4],
    branch: m[6] || 'main',
    filePath: m[7] || m[5],
  }
}

const jsd = (host: string, p: RawParts): string => `https://${host}/gh/${p.owner}/${p.repo}@${p.branch}/${p.filePath}`
const gh = (host: string, p: RawParts): string =>
  `https://${host}/https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.branch}/${p.filePath}`

/** 按优先级返回镜像 URL 列表，首位为 raw 原节点（保证维护者刚上传的内容最新） */
export function rawMirrors(p: RawParts): string[] {
  const raw = `${p.proto}://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.branch}/${p.filePath}`
  return [
    raw,
    jsd('fastly.jsdelivr.net', p),
    jsd('testingcf.jsdelivr.net', p),
    jsd('quantil.jsdelivr.net', p),
    jsd('gcore.jsdelivr.net', p),
    jsd('jsdelivr.b-cdn.net', p),
    jsd('cdn.jsdmirror.com', p),
    gh('gh-proxy.com', p),
    gh('ghproxy.net', p),
    gh('gh.llkk.cc', p),
    gh('ghfast.top', p),
    jsd('cdn.jsdelivr.net', p),
  ]
}

/* ---------------- 健康记忆 ---------------- */

interface MirrorState {
  /** 禁止使用至该时刻（时间戳） */
  failAt: number
  fails: number
  /** 最近一次成功的耗时（ms），用于动态排序 */
  lastMs: number
}

const state = new Map<string, MirrorState>()
const BASE_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 10 * 60_000

/** 镜像当前是否可用（未失败，或已过冷却期） */
export function isMirrorHealthy(url: string): boolean {
  const s = state.get(url)
  return !s || Date.now() >= s.failAt
}

export function markMirrorOk(url: string, ms: number): void {
  state.set(url, { failAt: 0, fails: 0, lastMs: ms })
}

/** 失败进入冷却：连续失败次数越多冷却越长（1min → 2min → 5min → 10min 封顶） */
export function markMirrorFail(url: string): void {
  const s = state.get(url) || { failAt: 0, fails: 0, lastMs: 0 }
  const fails = s.fails + 1
  const cool = Math.min(BASE_COOLDOWN_MS * (1 << Math.min(fails - 1, 4)), MAX_COOLDOWN_MS)
  state.set(url, { failAt: Date.now() + cool, fails, lastMs: s.lastMs })
}

/** 组装本次竞速的镜像列表：过滤冷却中的镜像，并按最近成功延迟升序（快者先启动） */
export function buildMirrorList(url: string, opts: { preferOrigin?: boolean } = {}): string[] {
  const parts = parseRaw(url)
  const list = parts ? rawMirrors(parts) : [url]
  const ordered = list
    .filter(u => isMirrorHealthy(u))
    .sort((a, b) => {
      const ma = state.get(a)?.lastMs ?? Infinity
      const mb = state.get(b)?.lastMs ?? Infinity
      return ma - mb
    })
  if (opts.preferOrigin && ordered.length > 1) {
    // 强制刷新场景：原节点保证最新，插到最前
    const orig = ordered.findIndex(u => u === list[0])
    if (orig > 0) {
      const [u] = ordered.splice(orig, 1)
      ordered.unshift(u)
    }
  }
  return ordered
}

/**
 * 并发竞速拉取：全部可用镜像并发，先到先得（Promise.any）。
 * 成功者记录延迟、失败者进入冷却，弱网下自动跳过坏镜像。
 */
export async function fetchFirstOk(
  url: string,
  timeout = 8000,
  opts: { preferOrigin?: boolean; headers?: Record<string, string> } = {}
): Promise<string> {
  const mirrors = buildMirrorList(url, { preferOrigin: opts.preferOrigin })
  if (!mirrors.length) throw new Error('无可用镜像（全部处于冷却期，可稍后重试）')
  const tasks = mirrors.map(async (u): Promise<string> => {
    const start = Date.now()
    try {
      const res = await request(u, {
        headers: { 'User-Agent': 'StarWish-Music', ...(opts.headers || {}) },
        timeout: Math.min(timeout, 8000),
      })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const body = typeof res.body === 'string' ? res.body : res.raw
      if (!body) throw new Error('响应为空')
      markMirrorOk(u, Date.now() - start)
      return body
    } catch (e: any) {
      markMirrorFail(u)
      throw e
    }
  })
  try {
    return await Promise.any(tasks)
  } catch (e: any) {
    const reasons: any[] = Array.isArray(e?.errors) ? e.errors : []
    const first = reasons.find(r => r?.message) || e
    throw new Error(`镜像拉取失败：${first?.message || String(first)}`)
  }
}
