/**
 * native-keymap 类型声明。
 *
 * 该包为 Node 原生模块（仅 Electron 主进程使用）；Tauri 迁移后渲染层/共享层
 * 仅引用其类型（IKeyboardLayoutInfo / IKeyboardMapping），不再安装运行时依赖，
 * 这里提供最小类型声明以保持 shared 类型文件的编译通过。
 */
declare module 'native-keymap' {
  export interface IKeyboardLayoutInfo {
    layout: string
    name: string
    id: string
    text: string
  }

  export interface IKeyboardMapping {
    [key: string]: string | undefined
  }

  export function getCurrentKeyboardLayout(): IKeyboardLayoutInfo
  export function getCurrentKeyboardLayouts(): IKeyboardLayoutInfo[]
  export function getCurrentKeymap(): IKeyboardMapping
}
