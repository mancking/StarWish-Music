/**
 * node:vm 的浏览器垫片。
 *
 * `electron/core/lx-host.ts` 只用 vm 做**音源脚本隔离与 20s 超时**
 * （`vm.createContext` + `vm.runInContext(code, ctx, {timeout})`），不承载
 * 任何平台语义。
 *
 * 用 `with (ctx)` 复刻 vm 的对象环境语义：sandbox 键作为**对象属性**参与
 * 标识符解析，而不是展开成 new Function 形参——形参是词法绑定，音源顶层
 * `const EVENT_NAMES`（lx-host.ts:266 把 EVENT_NAMES 放进 sandbox）会撞名
 * SyntaxError，真 vm 中属性与脚本顶层声明可以共存。
 *
 * ponytail: 与真 vm 的已知差异——脚本顶层 var 提升到本垫片的函数作用域
 * 而非 ctx，lx-host.ts:291 的 `sandbox.script` 名称兜底读不到（主路径
 * lx.send(inited) 不受影响）；忽略 opts.timeout（音源无死循环防护，
 * 升级路径：包一层 Web Worker 做真超时）。
 */
type Ctx = Record<string, any>

export function createContext(sandbox: Ctx = {}): Ctx {
  return { ...sandbox }
}

export function runInContext(code: string, ctx: Ctx, opts?: { filename?: string; timeout?: number }): any {
  // 临时全局键传 ctx：避开任何形参/局部名与音源声明撞名（同 EVENT_NAMES 教训）
  const key = '__lx_vm_ctx_' + Math.random().toString(36).slice(2)
  ;(globalThis as any)[key] = ctx
  // 先用 with(ctx) 复刻对象环境语义；再把每个 sandbox 键显式变成 new Function 形参
  // 兜底——插件源码若带 "use strict"（strict 模式禁用 with），或在延迟回调里引用
  // require 时，with 作用域已失效，显式形参保证 require/module/exports 一直是真实
  // 绑定，移动端不再报 "require is not defined"。
  const names = Object.keys(ctx).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
  const params = names.map((n) => `var ${n} = ${key}[${JSON.stringify(n)}];`).join('\n')
  try {
    return new Function(`${params}\nwith (${key}) {\n${code}\n}`)()
  } finally {
    delete (globalThis as any)[key]
  }
}

export function runInThisContext(code: string): any {
  return new Function(code)()
}

export function Script(code: string): { runInContext: (ctx: Ctx) => any } {
  return { runInContext: (ctx: Ctx) => runInContext(code, ctx) }
}

export default { createContext, runInContext, runInThisContext, Script }
