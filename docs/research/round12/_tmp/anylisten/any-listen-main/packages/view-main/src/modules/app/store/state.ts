export interface InitState {
  machineId: string
  proxyServerHost: string
  rootOffsetX: number
  rootOffsetY: number
  isShowPact: boolean
  isShowChangeLog: boolean
  isFullscreen: boolean

  workerInitPromiseMain: Promise<void>
  os: 'windows' | 'linux' | 'mac'
}

export const appState: InitState = {
  machineId: '',
  proxyServerHost: '',
  rootOffsetX: window.dt ? 0 : 8,
  rootOffsetY: window.dt ? 0 : 8,
  isShowPact: false,
  isShowChangeLog: false,
  isFullscreen: false,
  workerInitPromiseMain: Promise.resolve(),
  os: window.os,
}
