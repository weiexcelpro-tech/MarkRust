/**
 * 渲染层运行时注入的全局对象类型声明。
 *
 * tauri-bridge.ts 在模块加载时把 electron/fileUtils/path/... 等 10 个对象挂到
 * window（Tauri 无 preload，等价于 Electron 的 contextBridge 暴露层）；
 * window.DIRNAME 由编辑器 store 随活动文档更新；window.marktext 由
 * bootstrap.ts 注入启动环境。此文件把这些运行时契约固化成类型，
 * 消除全库 ~190 个 TS2551/TS2339。
 */
import type {
  commandExists as commandExistsBridge,
  electron as electronBridge,
  fileUtils as fileUtilsBridge,
  fonts as fontsBridge,
  i18nUtils as i18nUtilsBridge,
  path as pathBridge,
  process as processBridge,
  ripgrep as ripgrepBridge,
  rgPath as rgPathBridge,
  uploader as uploaderBridge
} from '../tauri-bridge'

/** bootstrap.ts 注入的启动环境（字段运行时均可能先于注入被访问，全部可选）。 */
interface MarktextWindowState {
  initialState?: Record<string, unknown>
  env?: {
    debug?: boolean
    paths?: { ripgrepBinaryPath?: string }
    windowId?: number
    type?: string
  }
  paths?: { ripgrepBinaryPath?: string }
}

declare global {
  interface Window {
    /** tauri-bridge 注入的 IPC 桥（ipcRenderer/shell/clipboard/windowControl 等） */
    electron: typeof electronBridge
    process: typeof processBridge
    rgPath: typeof rgPathBridge
    fileUtils: typeof fileUtilsBridge
    path: typeof pathBridge
    commandExists: typeof commandExistsBridge
    i18nUtils: typeof i18nUtilsBridge
    ripgrep: typeof ripgrepBridge
    uploader: typeof uploaderBridge
    fonts: typeof fontsBridge
    /** 当前活动文档所在目录，随标签切换由编辑器 store 更新 */
    DIRNAME: string
    marktext?: MarktextWindowState
  }
}

export {}
