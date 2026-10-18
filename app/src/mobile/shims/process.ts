/** process 全局垫片：只要 core 真正读到的几个字段。 */
const env: Record<string, string> = {
  STARWISH_QUIET: '1',
  NODE_ENV: 'production',
}

const proc: any = {
  platform: 'android',
  arch: 'arm64',
  versions: { node: '22', chrome: '120', electron: '' },
  env,
  argv: ['node'],
  cwd: () => '/home/user',
  resourcesPath: '/home/user',
  nextTick: (fn: (...args: any[]) => void, ...args: any[]) => queueMicrotask(() => fn(...args)),
  on: () => proc,
  once: () => proc,
  emit: () => false,
  exit: () => undefined,
  stdout: { write: () => true },
  stderr: { write: () => true },
}

export default proc
