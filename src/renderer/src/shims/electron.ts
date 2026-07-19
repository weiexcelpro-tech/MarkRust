// electron shim：渲染层所有 `import { ... } from 'electron'` 的兜底实现。
// ipcRenderer/shell/clipboard 等的真实实现在 tauri-bridge.ts 注入到 window.*；
// 此 shim 仅用于源码顶层 `import` 语句的解析（这些 import 在运行时几乎不被调用，
// 因为渲染层通过 window.electron.* 而非直接 import electron 访问）。

const noop = (): void => {}
const noopPromise = <T = unknown>(): Promise<T> => Promise.resolve(null as unknown as T)

class IpcRenderer {
  invoke = noopPromise
  send = noop
  sendSync = (): undefined => undefined
  on = (_ch: string, _cb: (...a: unknown[]) => void): this => this
  once = (_ch: string, _cb: (...a: unknown[]) => void): this => this
  off = (_ch: string, _cb?: (...a: unknown[]) => void): this => this
  removeListener = (_ch: string, _cb?: (...a: unknown[]) => void): this => this
  removeAllListeners = (_ch?: string): this => this
  postMessage = noop
}

const ipcRenderer = new IpcRenderer()

const shell = {
  openExternal: noopPromise,
  openPath: noopPromise,
  showItemInFolder: noop,
  writeShortcutLink: noop,
  readShortcutLink: () => ({}),
  beep: noop
}

const clipboard = {
  readText: (): string => '',
  writeText: noop,
  readHTML: (): string => '',
  writeHTML: noop,
  readImage: () => ({}),
  writeImage: noop,
  readRTF: (): string => '',
  writeRTF: noop,
  readBookmark: () => null,
  writeBookmark: noop,
  clear: noop,
  availableFormats: (): string[] => []
}

const webFrame = {
  setZoomFactor: (factor: number) => {
    if (typeof factor === 'number' && factor > 0) {
      import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
        getCurrentWebview().setZoom(factor).catch((e: unknown) => console.warn('[shim] setZoom failed:', e))
      })
    }
  },
  setZoomLevel: (level: number) => {
    const factor = 1 + level * 0.2
    if (factor > 0) {
      import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
        getCurrentWebview().setZoom(factor).catch((e: unknown) => console.warn('[shim] setZoom failed:', e))
      })
    }
  },
  getZoomFactor: (): number => 1,
  getZoomLevel: (): number => 0,
  executeJavaScript: noopPromise,
  executeJavaScriptInIsolatedWorld: noopPromise,
  insertCSS: noopPromise,
  removeInsertedCSS: noopPromise
}

const webUtils = {
  getPathForFile: (_file: File): string => ''
}

const processShim = {
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64' as string,
  env: {} as Record<string, string | undefined>,
  versions: {} as Record<string, string | number>,
  cwd: (): string => '',
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]): void => {
    Promise.resolve().then(() => fn(...args))
  }
}

const app = {
  getPath: (): string => '',
  getName: (): string => 'marktext',
  getVersion: (): string => '0.0.0',
  isReady: (): boolean => true,
  on: noop,
  off: noop,
  quit: noop,
  relaunch: noop
}

class BrowserWindow {
  static getAllWindows = (): BrowserWindow[] => []
  static fromWebContents = (): BrowserWindow | null => null
  static getFocusedWindow = (): BrowserWindow | null => null
  constructor(..._args: unknown[]) {}
  loadURL = noopPromise
  loadFile = noopPromise
  on = noop
  once = noop
  off = noop
  show = noop
  hide = noop
  close = noop
  minimize = noop
  maximize = noop
  unmaximize = noop
  isMaximized = (): boolean => false
  setFullScreen = noop
  isFullScreen = (): boolean => false
  webContents: unknown = { send: noop, on: noop }
}

const contextBridge = {
  exposeInMainWorld: noop
}

const Menu = {
  buildFromTemplate: (): unknown => ({}),
  setApplicationMenu: noop,
  getApplicationMenu: (): unknown => null,
  popup: noop,
  append: noop
}

const MenuItem = class MenuItem {
  constructor(..._args: unknown[]) {}
}

const nativeImage = {
  createFromPath: () => ({}),
  createFromBuffer: () => ({}),
  createFromDataURL: () => ({}),
  createEmpty: () => ({})
}

const screen = {
  getPrimaryDisplay: () => ({
    workAreaSize: { width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1
  }),
  getAllDisplays: () => []
}

const dialog = {
  showOpenDialog: noopPromise,
  showSaveDialog: noopPromise,
  showMessageBox: noopPromise,
  showErrorBox: noop
}

const session = {
  defaultSession: {
    on: noop,
    off: noop,
    webRequest: { onBeforeRequest: noop, onHeadersReceived: noop }
  }
}

const Tray = class Tray {
  constructor(..._args: unknown[]) {}
  setToolTip = noop
  setImage = noop
  setContextMenu = noop
  on = noop
}

export {
  ipcRenderer,
  IpcRenderer,
  shell,
  clipboard,
  webFrame,
  webUtils,
  processShim as process,
  app,
  BrowserWindow,
  contextBridge,
  Menu,
  MenuItem,
  nativeImage,
  screen,
  dialog,
  session,
  Tray
}

export default {
  ipcRenderer,
  shell,
  clipboard,
  webFrame,
  webUtils,
  process: processShim,
  app,
  BrowserWindow,
  contextBridge,
  Menu,
  MenuItem,
  nativeImage,
  screen,
  dialog,
  session,
  Tray
}
