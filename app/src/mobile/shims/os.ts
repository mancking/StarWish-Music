/** node:os 的浏览器垫片：只提供 core 真正读到的几个字段。 */
function home(): string {
  return '/home/user'
}

export function tmpdir(): string {
  return '/tmp'
}

export function platform(): string {
  return 'android'
}

export function homedir(): string {
  return home()
}

export function hostname(): string {
  return 'starwish-mobile'
}

export function type(): string {
  return 'Linux'
}

export function release(): string {
  return ''
}

export const EOL = '\n'
export const arch = 'arm64'
export default { homedir, tmpdir, platform, hostname, type, release, EOL, arch }
