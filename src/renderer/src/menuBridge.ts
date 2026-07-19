// menuBridge.ts: 全局菜单点击 → renderer 命令分发。
// Rust on_menu_event emit "mt::menu::click" { id: "file.new-window" }，
// 此处查找 commands 数组中 id 匹配的命令并执行 execute()。
// 对于子命令（如 file.export-file-html），查找 parent 并调用 executeSubcommand。

import commands, { type CommandDescriptor } from './commands'
import bus from './bus'
import { localEmit } from './tauri-bridge'
import { getVersion } from '@tauri-apps/api/app'

// Electron checkbox 菜单项 ID → renderer view mode 名称
// marktext-develop 通过 main 进程 webContents.send('mt::toggle-view-mode-entry', type)
// Tauri 中用 localEmit 模拟（preferences store 监听此 event）
const CHECKBOX_MENU_MAP: Record<string, string> = {
  sourceCodeModeMenuItem: 'sourceCode',
  typewriterModeMenuItem: 'typewriter',
  focusModeMenuItem: 'focus',
}

// Format 菜单 checkbox ID → muya format type
// marktext-develop: MENU_ID_FORMAT_MAP → webContents.send('mt::editor-format-action', { type })
const FORMAT_MENU_MAP: Record<string, string> = {
  strongMenuItem: 'strong',
  emphasisMenuItem: 'em',
  underlineMenuItem: 'u',
  superscriptMenuItem: 'sup',
  subscriptMenuItem: 'sub',
  highlightMenuItem: 'mark',
  inlineCodeMenuItem: 'inline_code',
  strikeMenuItem: 'del',
  hyperlinkMenuItem: 'link',
  imageMenuItem: 'image',
  inlineMathMenuItem: 'inline_math',
  clearFormatMenuItem: 'clear',
}

// Layout checkbox 菜单 ID → layout key（通过 mt::set-view-layout event 切换）
const LAYOUT_MENU_MAP: Record<string, string> = {
  sideBarMenuItem: 'showSideBar',
  tabBarMenuItem: 'showTabBar',
  tocMenuItem: 'rightColumn',
}

// Help 菜单 ID → 外部 URL
const HELP_MENU_MAP: Record<string, string> = {
  'help.markdown-reference': 'https://commonmark.org/help/',
  'help.view-source': 'https://github.com/marktext/marktext',
  'help.report-bug': 'https://github.com/marktext/marktext/issues',
  'help.changelog': 'https://github.com/marktext/marktext/releases',
}

const findCommand = (id: string): { parent?: CommandDescriptor; cmd?: CommandDescriptor } => {
  for (const cmd of commands) {
    if (cmd.id === id) return { cmd }
    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        if (sub.id === id) return { parent: cmd, cmd: sub }
      }
    }
  }
  return {}
}

export const handleMenuClick = (id: string): void => {
  const viewMode = CHECKBOX_MENU_MAP[id]
  if (viewMode) {
    console.log('[menuBridge] toggle view mode:', viewMode)
    localEmit('mt::toggle-view-mode-entry', viewMode)
    return
  }

  const formatType = FORMAT_MENU_MAP[id]
  if (formatType) {
    console.log('[menuBridge] format:', formatType)
    localEmit('mt::editor-format-action', { type: formatType })
    return
  }

  const layoutKey = LAYOUT_MENU_MAP[id]
  if (layoutKey) {
    bus.emit('view:toggle-layout-entry', layoutKey)
    return
  }

  const helpUrl = HELP_MENU_MAP[id]
  if (helpUrl) {
    console.log('[menuBridge] open help:', helpUrl)
    window.electron.shell.openExternal(helpUrl)
    return
  }

  if (id === 'help.about') {
    getVersion()
      .then(v => alert(`MarkRust v${v}\n\nMarkdown editor powered by Rust + Tauri 2`))
      .catch(() => alert('MarkRust\n\nMarkdown editor powered by Rust + Tauri 2'))
    return
  }

  if (id === 'view.command-palette') {
    bus.emit('command-palette:open')
    return
  }

  if (id === 'view.reload-images') {
    window.location.reload()
    return
  }

  const { parent, cmd } = findCommand(id)

  if (!cmd) {
    console.warn('[menuBridge] no command for menu id:', id)
    return
  }

  console.log('[menuBridge] executing:', id)

  try {
    if (parent && parent.executeSubcommand) {
      parent.executeSubcommand(id)
    } else if (cmd.execute) {
      cmd.execute()
    } else {
      console.warn('[menuBridge] command has no execute:', id)
    }
  } catch (err) {
    console.error('[menuBridge] execution error:', id, err)
  }
}

window.electron.ipcRenderer.on('mt::menu::click', (_event, message) => {
  const payload = message as { id?: string } | string | undefined
  const id = typeof payload === 'string' ? payload : payload?.id ?? ''
  if (id) {
    handleMenuClick(id)
  }
})

bus.on('menuBridge:ready', () => {
  console.log('[menuBridge] initialized,', commands.length, 'commands registered')
})

console.log('[menuBridge] loaded')
