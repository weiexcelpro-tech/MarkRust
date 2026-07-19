// electron-updater shim：Tauri 版本通过 invoke('updater_check_latest') 检查更新，
// 此 shim 仅满足 import 解析；方法全部 noop，避免误触发 Electron 自动更新逻辑。

type VoidFn = (...args: unknown[]) => void

const noop = (): void => {}
const noopStr = (): string => ''
const noopPromiseNull = (): Promise<null> => Promise.resolve(null)
const noopPromiseArr = (): Promise<string[]> => Promise.resolve([])

class NoopUpdater {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowDowngrade = false
  fullChangelog = false

  on = (_event: string, _cb: VoidFn): this => this
  once = (_event: string, _cb: VoidFn): this => this
  off = (_event: string, _cb: VoidFn): this => this
  emit = (_event: string, ..._args: unknown[]): boolean => false
  removeAllListeners = (_event?: string): this => this

  getFeedURL = noopStr
  setFeedURL = noop
  checkForUpdates = noopPromiseNull
  checkForUpdatesAndNotify = noopPromiseNull
  downloadUpdate = noopPromiseArr
  quitAndInstall = noop
}

const autoUpdater = new NoopUpdater()

export default autoUpdater
export { autoUpdater, NoopUpdater }
