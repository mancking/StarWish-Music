/**
 * node:vm 的浏览器垫片。
 *
 * `electron/core/lx-host.ts` 只用 vm 做**音源脚本隔离与 20s 超时**
 * （`vm.createContext` + `vm.runInContext(code, ctx, {timeout})`），不承载
 * 任何平台语义 → `new Function` 足够：音源脚本的自由变量从 ctx 解析，
 * 与 vm 的 with(sandbox) 语义一致。
 */
type Ctx = Record<string, any>

export function createContext(sandbox: Ctx = {}): Ctx {
  return { ...sandbox }
}

export function runInContext(code: string, ctx: Ctx, opts?: { filename?: string; timeout?: number }): any {
  const keys = Object.keys(ctx || {})
  const values = keys.map(k => ctx[k])
  const factory = new Function(...keys, code)
  return factory(...values)
}

export function runInThisContext(code: string): any {
  return new Function(code)()
}

export function Script(code: string): { runInContext: (ctx: Ctx) => any } {
  return { runInContext: (ctx: Ctx) => runInContext(code, ctx) }
}

export default { createContext, runInContext, runInThisContext, Script }
