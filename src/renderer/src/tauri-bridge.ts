// tauri-bridge.ts：替代 Electron preload，把 Rust 端 65 个 invoke commands 包装为
// 渲染层原有的 10 个 `window.*` 全局对象（electron/fileUtils/process/ripgrep/...）。
// Channel 名映射规则：preload 的 `mt::fs::read-file` → Rust `fs_read_file`。
// 必须在 main.ts 创建 Vue app 前导入，确保所有 window.* 已注入。

import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

// MarkdownFileResult: fs_read_markdown 返回值，与 Rust MarkdownFileResult 对齐
interface MarkdownFileResult {
  markdown: string
  filename: string
  pathname: string
  encoding: { encoding: string; isBom: boolean }
  lineEnding: string
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
  isMixedLineEndings: boolean
}

// bootstrap.ts 的 parseUrlArgs() 从 URL ?wid=&type=&udp= 读取窗口参数，
// Electron 由主进程在加载 URL 时附加；Tauri 无此机制，此处根据窗口 label 注入。
let winLabel = 'main'
try {
  winLabel = getCurrentWindow().label
} catch {
  console.warn('[tauri-bridge] getCurrentWindow().label failed, defaulting to main')
}
// getCurrentWindow().label 可能不可靠，直接读 Tauri 内部 metadata 作为 fallback
const internalLabel = (globalThis as Record<string, unknown>)?.__TAURI_INTERNALS__
  ? ((globalThis as Record<string, Record<string, unknown>>).__TAURI_INTERNALS__?.metadata as Record<string, unknown>)?.currentWindow as Record<string, unknown> | undefined
  : undefined
if (internalLabel?.label) {
  winLabel = internalLabel.label as string
}
const isSettings = winLabel === 'settings'
console.log('[tauri-bridge] window label:', winLabel, 'isSettings:', isSettings, 'internalLabel:', internalLabel)

// 异步获取真实的 app_data_dir 路径，替换硬编码的 userData 路径。
// main.ts 在调用 bootstrapRenderer() 前会 await 此 Promise。
const userDataDirReady = (async () => {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('wid')) {
    // type/wid 同步写入 URL，确保 main.ts 创建路由时能立即读到正确的 type
    params.set('wid', isSettings ? '1' : '0')
    params.set('type', isSettings ? 'settings' : 'editor')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)

    let udp = ''
    try {
      udp = await invoke<string>('get_user_data_dir')
    } catch (e) {
      console.error('[tauri-bridge] get_user_data_dir failed:', e)
    }
    params.set('udp', udp)
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }
})()
// 暴露到全局，让 main.ts 在 bootstrapRenderer() 之前 await
;(globalThis as Record<string, unknown>).__TAURI_USER_DATA_DIR_READY__ = userDataDirReady

// preload 用 `mt::fs::read-file` 这类命名空间 channel，Rust 端是 `fs_read_file`。
// 渲染层代码偶尔直接调用 `window.electron.ipcRenderer.invoke(channel, ...args)`，
// 此表把这些直接调用映射到对应 Tauri command（参数重新打包为对象）。
type ArgMapper = (args: unknown[]) => Record<string, unknown> | null

const INVOKE_CHANNEL_MAP: Record<string, { cmd: string; map: ArgMapper }> = {
  'mt::fs::is-file': { cmd: 'fs_is_file', map: ([p]) => ({ path: p }) },
  'mt::fs::is-directory': { cmd: 'fs_is_directory', map: ([p]) => ({ path: p }) },
  'mt::fs::path-exists': { cmd: 'fs_path_exists', map: ([p]) => ({ path: p }) },
  'mt::fs::ensure-dir': { cmd: 'fs_ensure_dir', map: ([p]) => ({ path: p }) },
  'mt::fs::empty-dir': { cmd: 'fs_empty_dir', map: ([p]) => ({ path: p }) },
  'mt::fs::copy': { cmd: 'fs_copy', map: ([s, d]) => ({ src: s, dest: d }) },
  'mt::fs::move': { cmd: 'fs_move', map: ([s, d]) => ({ src: s, dest: d }) },
  'mt::fs::unlink': { cmd: 'fs_unlink', map: ([p]) => ({ path: p }) },
  'mt::fs::readdir': { cmd: 'fs_readdir', map: ([p]) => ({ path: p }) },
  'mt::fs::read-file': { cmd: 'fs_read_file', map: ([p, enc]) => ({ path: p, encoding: enc }) },
  'mt::fs::read-markdown': { cmd: 'fs_read_markdown', map: ([p, eol, autoGuess, trim, autoNorm]) => ({ path: p, preferredEol: eol, autoGuessEncoding: autoGuess, trimTrailingNewline: trim, autoNormalizeLineEndings: autoNorm }) },
  'mt::fs::write-file': { cmd: 'fs_write_file', map: ([p, d]) => ({ path: p, data: toBytes(d) }) },
  'mt::fs::output-file': { cmd: 'fs_output_file', map: ([p, d]) => ({ path: p, data: toBytes(d) }) },
  'mt::fs::stat': { cmd: 'fs_stat', map: ([p]) => ({ path: p }) },
  'mt::fs::is-executable': { cmd: 'fs_is_executable', map: ([p]) => ({ path: p }) },
  'mt::fs::trash-item': { cmd: 'fs_trash_item', map: ([p]) => ({ path: p }) },
  'mt::fs-trash-item': { cmd: 'fs_trash_item', map: ([p]) => ({ path: p }) },
  'mt::ask-for-image-path': { cmd: 'ask_for_image_path', map: () => ({}) },
  'mt::paths::is-image': { cmd: 'paths_is_image', map: ([p]) => ({ path: p }) },
  'mt::paths::is-same': { cmd: 'paths_is_same', map: ([a, b]) => ({ pathA: a, pathB: b }) },
  'mt::cmd::exists': { cmd: 'cmd_exists', map: ([c]) => ({ command: c }) },
  'mt::i18n::load': { cmd: 'i18n_load', map: ([l]) => ({ locale: l }) },
  'mt::i18n::is-supported': { cmd: 'i18n_is_supported', map: ([l]) => ({ locale: l }) },
  'mt::i18n::supported': { cmd: 'i18n_supported', map: () => ({}) },
  'mt::fonts::list': { cmd: 'fonts_list', map: () => ({}) },
  'mt::uploader::upload': { cmd: 'uploader_upload', map: ([r]) => ({ req: r }) },
  'mt::shell::open-external': { cmd: 'shell_open_external', map: ([u]) => ({ url: u }) },
  'mt::shell::open-path': { cmd: 'shell_open_path', map: ([p]) => ({ path: p }) },
  'mt::clipboard::read-text': { cmd: 'clipboard_read_text', map: () => ({}) },
  'mt::clipboard::guess-file-path': { cmd: 'clipboard_guess_file_path', map: () => ({}) },
  'mt::win::is-maximized': { cmd: 'window_is_maximized', map: () => ({ label: currentLabel() }) },
  'mt::win::is-fullscreen': { cmd: 'win_is_fullscreen', map: () => ({ label: currentLabel() }) },
  'mt::boot-info': { cmd: 'boot_info_async', map: () => ({}) },
  'mt::spellchecker-set-enabled': { cmd: 'spellchecker_set_enabled', map: ([e]) => ({ enabled: e }) },
  'mt::spellchecker-switch-language': { cmd: 'spellchecker_switch_language', map: ([l]) => ({ lang: l }) },
  'mt::spellchecker-get-available-dictionaries': { cmd: 'spellchecker_get_available_dictionaries', map: () => ({}) },
  'mt::spellchecker-remove-word': { cmd: 'spellchecker_remove_word', map: ([w]) => ({ word: w }) },
  'mt::spellchecker-get-custom-dictionary-words': { cmd: 'spellchecker_get_custom_dictionary_words', map: () => ({}) },
  'mt::clipboard::write-text': { cmd: 'clipboard_write_text', map: ([t]) => ({ text: t }) }
}

// sendSync 仅用于 `mt::paths::is-same-sync` 这类同步 IPC；Tauri 无同步 IPC，
// 返回 false 让调用方走 pathe normalize 后的字符串比较回退路径。
const SENDSYNC_CHANNEL_MAP: Record<string, (...args: unknown[]) => unknown> = {
  'mt::paths::is-same-sync': () => false,
  'mt::boot-info': () => null
}

// send 多数是单向事件（windowControl / clipboard.writeText / rg.cancel 等），
// 在 Tauri 中通过 emit 转发，Rust 端可选监听。
const SEND_CHANNEL_EMIT_MAP: Record<string, (args: unknown[]) => unknown> = {
  'mt::rg::cancel': ([id]) => invoke('rg_cancel', { searchId: id }),
  'mt::clipboard::write-text': ([t]) => invoke('clipboard_write_text', { text: t }),
  'mt::cmd-open-file': async () => {
    const path = await invoke<string | null>('dialog_open_file')
    if (!path) return
    console.log('[tauri-bridge] file selected:', path)
    const result = await invoke<MarkdownFileResult>('fs_read_markdown', { path })
    localEmit('mt::open-new-tab', result, {}, true)
    invoke('recent_add', { filePath: path }).catch(() => {})
  },
  'mt::cmd-open-folder': async () => {
    const dir = await invoke<string | null>('dialog_open_directory')
    if (!dir) return
    console.log('[tauri-bridge] folder selected:', dir)
    localEmit('mt::open-directory', dir)
  },
  'mt::cmd-import-file': async () => {
    const path = await invoke<string | null>('dialog_open_file')
    if (!path) return
    const result = await invoke<MarkdownFileResult>('fs_read_markdown', { path })
    localEmit('mt::open-new-tab', result, {}, true)
  },
  'mt::cmd-new-editor-window': () => invoke('window_new_editor'),
  'mt::cmd-close-window': () => invoke('window_close', { label: currentLabel() }),
  'mt::cmd-toggle-autosave': async () => {
    const prefs = await invoke<Record<string, unknown>>('preferences_get_all')
    const current = !prefs.autoSave
    await invoke('preferences_set', { partial: { autoSave: current } })
    localEmit('mt::set-user-preference', { autoSave: current })
  },
  'mt::set-user-preference': (args) => {
    const partial = args[0] as Record<string, unknown>
    invoke('preferences_set', { partial })
    localEmit('mt::user-preference', partial)
  },
  'mt::open-setting-window': () => localEmit('mt::sidebar-show-settings'),
  'mt::window-toggle-always-on-top': () => invoke('window_toggle_always_on_top', { label: currentLabel() }),
  'mt::check-for-update': async () => {
    const result = await invoke('updater_check_latest', { owner: 'marktext', repo: 'marktext', currentVersion: '0.0.1' })
    if (result && (result as Record<string, unknown>).has_update) {
      localEmit('mt::UPDATE_AVAILABLE', result)
    } else {
      localEmit('mt::UPDATE_NOT_AVAILABLE', {})
    }
  },
  'mt::app-try-quit': () => invoke('window_close', { label: currentLabel() }),
  'mt::make-screenshot': () => {},
  'mt::save-tabs': () => {},
  'mt::response-file-save': async (args) => {
    const [id, filename, pathname, markdown, options] = args as [
      string, string, string, string,
      { encoding?: { encoding?: string; isBom?: boolean } | string; lineEnding?: string; adjustLineEndingOnSave?: boolean; trimTrailingNewline?: number },
      string
    ]
    if (!id) return
    let savePath = pathname
    if (!savePath) {
      savePath = await invoke<string | null>('dialog_save_file', { defaultName: filename || undefined })
      if (!savePath) return
    }
    const { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline } = options || {}
    try {
      await invoke('markdown_save', {
        path: savePath,
        markdown,
        lineEnding: lineEnding || 'lf',
        adjustLineEndingOnSave: adjustLineEndingOnSave || false,
        encoding: typeof encoding === 'string' ? encoding : (encoding?.encoding || 'utf-8'),
        isBom: typeof encoding === 'string' ? false : (encoding?.isBom ?? false),
        trimTrailingNewline: trimTrailingNewline ?? 2
      })
      // 抑制保存自反馈：1.5s 内忽略同路径的 mt::update-file
      markPathAsSaved(savePath)
      localEmit('mt::tab-saved', id)
      localEmit('mt::set-pathname', { pathname: savePath, id, filename: pathe.basename(savePath) })
      // P2-23: 保存成功后添加到最近使用列表
      invoke('recent_add', { filePath: savePath }).catch(() => {})
    } catch (e) {
      localEmit('mt::tab-save-failure', id, String(e))
    }
  },
  'mt::response-file-save-as': async (args) => {
    const [id, filename, _pathname, markdown, options] = args as [
      string, string, string, string,
      { encoding?: { encoding?: string; isBom?: boolean } | string; lineEnding?: string; adjustLineEndingOnSave?: boolean; trimTrailingNewline?: number },
      string
    ]
    if (!id) return
    const savePath = await invoke<string | null>('dialog_save_file', { defaultName: filename || undefined })
    if (!savePath) return
    const { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline } = options || {}
    try {
      await invoke('markdown_save', {
        path: savePath,
        markdown,
        lineEnding: lineEnding || 'lf',
        adjustLineEndingOnSave: adjustLineEndingOnSave || false,
        encoding: typeof encoding === 'string' ? encoding : (encoding?.encoding || 'utf-8'),
        isBom: typeof encoding === 'string' ? false : (encoding?.isBom ?? false),
        trimTrailingNewline: trimTrailingNewline ?? 2
      })
      // 抑制保存自反馈：1.5s 内忽略同路径的 mt::update-file
      markPathAsSaved(savePath)
      localEmit('mt::tab-saved', id)
      localEmit('mt::set-pathname', { pathname: savePath, id, filename: pathe.basename(savePath) })
      // P2-23: SaveAs 成功后添加到最近使用列表
      invoke('recent_add', { filePath: savePath }).catch(() => {})
    } catch (e) {
      localEmit('mt::tab-save-failure', id, String(e))
    }
  },
  'mt::close-window-confirm': async (args) => {
    const unsaved = args[0] as unknown[]
    if (unsaved && unsaved.length > 0) {
      const ok = await confirm('You have unsaved changes. Close anyway?', {
        title: 'Unsaved Changes',
        kind: 'warning',
      })
      if (!ok) return
    }
    invoke('window_close', { label: currentLabel() })
  },
  'mt::window-initialized': () => {},
  'mt::window-tab-closed': async (args) => {
    const pathname = args[0] as string
    if (pathname) {
      try { await invoke('unwatch_file', { path: pathname }) } catch { /* tab may not have been watched */ }
    }
  },
  'mt::request-keybindings': async () => {
    try {
      const map = await invoke<Record<string, string>>('get_keybindings')
      localEmit('mt::keybindings-response', map)
    } catch (e) {
      console.error('[tauri-bridge] get_keybindings failed:', e)
    }
  },
  'mt::ask-for-image-auto-path': async (args) => {
    const { pathname, src, id } = args[0] as { pathname: string; src: string; id: string; currentFile: unknown }
    if (!src || typeof src !== 'string') {
      localEmit(`mt::response-of-image-path-${id}`, [])
      return
    }
    try {
      const files = await invoke<Array<{ file: string; type: string }>>('image_auto_path', { pathname, src })
      localEmit(`mt::response-of-image-path-${id}`, files)
    } catch (e) {
      console.error('[tauri-bridge] image_auto_path failed:', e)
      localEmit(`mt::response-of-image-path-${id}`, [])
    }
  },
  'mt::format-link-click': async (args) => {
    const { data, dirname } = args[0] as { data: { href?: string; text?: string }; dirname: string }
    if (!data || (!data.href && !data.text)) return
    try {
      await invoke('format_link_click', { data, dirname })
    } catch (e) {
      console.error('[tauri-bridge] format_link_click failed:', e)
    }
  },
  'mt::rename': async (args) => {
    const { id, pathname, newPathname } = args[0] as { id: string; pathname: string; newPathname: string }
    if (!id || !pathname || !newPathname) return
    try {
      await invoke('fs_move', { src: pathname, dest: newPathname })
      localEmit('mt::set-pathname', { pathname: newPathname, id, filename: pathe.basename(newPathname) })
    } catch (e) {
      console.error('[tauri-bridge] rename failed:', e)
    }
  },
  'mt::response-export': async (args) => {
    const { type, content, filename, pathname, fontFamily, fontSize, lineHeight } = args[0] as {
      type: string; content: string; filename: string; pathname: string
      fontFamily?: string; fontSize?: number; lineHeight?: number
    }
    if (type === 'pdf') {
      window.print()
      return
    }
    if (type === 'docx') {
      // v2.0: DOCX 导出走 Rust 后端 export_docx 命令
      // 后端内部会弹出保存对话框，前端不需再调 dialog_save_file
      try {
        const prefs = await invoke<Record<string, unknown>>('preferences_get_all')
        const result = await invoke<{
          path: string
          size: number
          imageCount: number
          warnings: string[]
        }>('export_docx', {
          req: {
            markdown: content,
            pathname: pathname || '',
            imageEmbed: true, // DOCX 强约束自包含 (PRD AC-32)，始终内嵌
            imageResize: (prefs.exportImageResize as string) || 'auto',
            imageMaxWidth: (prefs.exportImageMaxWidth as number) || 1024,
            pageSize: (prefs.docxPageSize as string) || 'A4',
            pageMargin: (prefs.docxPageMargin as string) || 'normal',
            fontFamily: fontFamily ?? null,
            fontSize: fontSize ?? 11,
            lineHeight: lineHeight ?? 1.5
          }
        })
        localEmit('mt::export-success', {
          filePath: result.path,
          extra: {
            size: result.size,
            imageCount: result.imageCount,
            warnings: result.warnings
          }
        })
      } catch (e) {
        console.error('[tauri-bridge] export_docx failed:', e)
        localEmit('mt::export-failure', { error: String(e) })
      }
      return
    }
    const baseName = (filename || pathe.basename(pathname || '') || 'export')
      .replace(/\.(md|markdown)$/i, '')
    const savePath = await invoke<string | null>('dialog_save_file', { defaultName: `${baseName}.html` })
    if (!savePath) return
    await invoke('fs_write_file', { path: savePath, data: content ?? '' })
    localEmit('mt::export-success', { filePath: savePath })
  },
  'mt::response-print': async () => {
    window.print()
    localEmit('mt::print-service-clearup')
  },
  'mt::response-file-move-to': async (args) => {
    const { id, pathname } = args[0] as { id: string; pathname: string }
    if (!id || !pathname) return
    const destDir = await invoke<string | null>('dialog_open_directory')
    if (!destDir) return
    const fileBaseName = pathe.basename(pathname)
    const newPath = pathe.join(destDir, fileBaseName)
    try {
      await invoke('fs_move', { src: pathname, dest: newPath })
      localEmit('mt::set-pathname', { pathname: newPath, id, filename: fileBaseName })
    } catch (e) {
      console.error('[tauri-bridge] move-to failed:', e)
    }
  },
  'mt::NEED_UPDATE': () => {},
  'mt::save-and-close-tabs': async (args) => {
    const tabs = args[0] as Array<{ id: string; pathname: string; filename: string; markdown: string; options: Record<string, unknown> }>
    if (!tabs || !tabs.length) return
    const closeIds: string[] = []
    for (const tab of tabs) {
      // If the tab has no pathname, it's a new unsaved file — ask to discard
      if (!tab.pathname) {
        const ok = await confirm('Close without saving?', {
          title: 'Unsaved Changes',
          kind: 'warning',
          okLabel: 'Don\'t Save',
          cancelLabel: 'Cancel'
        }).catch(() => false)
        if (ok) closeIds.push(tab.id)
        // If cancelled, skip this tab
        continue
      }
      // Tab has a pathname — try to save first, then close
      try {
        const { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline } = tab.options || {}
        await invoke('markdown_save', {
          path: tab.pathname,
          markdown: tab.markdown,
          lineEnding: lineEnding || 'lf',
          adjustLineEndingOnSave: adjustLineEndingOnSave || false,
          encoding: typeof encoding === 'string' ? encoding : ((encoding as Record<string, unknown>)?.encoding as string || 'utf-8'),
          isBom: typeof encoding === 'string' ? false : ((encoding as Record<string, unknown>)?.isBom as boolean ?? false),
          trimTrailingNewline: trimTrailingNewline ?? 2
        })
        // 抑制保存自反馈：1.5s 内忽略同路径的 mt::update-file
        markPathAsSaved(tab.pathname)
        closeIds.push(tab.id)
      } catch (e) {
        // Save failed — ask to discard
        const ok = await confirm(`Save failed: ${e}. Close without saving?`, {
          title: 'Save Failed',
          kind: 'warning',
          okLabel: 'Don\'t Save',
          cancelLabel: 'Cancel'
        }).catch(() => false)
        if (ok) closeIds.push(tab.id)
      }
    }
    if (closeIds.length) {
      localEmit('mt::force-close-tabs-by-id', closeIds)
    }
  },
  'mt::ask-for-user-preference': async () => {
    const prefs = await invoke<Record<string, unknown>>('preferences_get_all')
    localEmit('mt::user-preference', prefs)
  },
  'mt::ask-for-user-data': () => {},
  'mt::close-window': () => invoke('window_close', { label: currentLabel() }),
  'mt::view-layout-changed': (args) => {
    // args: [windowId, { showSideBar?, showTabBar?, sourceCode?, typewriter?, focus? }]
    const changes = args[1] as Record<string, unknown> | undefined
    if (!changes) return
    for (const key in changes) {
      const value = changes[key]
      switch (key) {
        case 'showSideBar':
          invoke('menu_set_checked', { id: 'sideBarMenuItem', checked: !!value }).catch(() => {})
          break
        case 'showTabBar':
          invoke('menu_set_checked', { id: 'tabBarMenuItem', checked: !!value }).catch(() => {})
          break
        case 'sourceCode':
          invoke('menu_set_checked', { id: 'sourceCodeModeMenuItem', checked: !!value }).catch(() => {})
          // sourceCode 模式下禁用 focus/typewriter
          invoke('menu_set_enabled', { id: 'focusModeMenuItem', enabled: !value }).catch(() => {})
          invoke('menu_set_enabled', { id: 'typewriterModeMenuItem', enabled: !value }).catch(() => {})
          break
        case 'typewriter':
          invoke('menu_set_checked', { id: 'typewriterModeMenuItem', checked: !!value }).catch(() => {})
          break
        case 'focus':
          invoke('menu_set_checked', { id: 'focusModeMenuItem', checked: !!value }).catch(() => {})
          break
      }
    }
  },
  'mt::handle-renderer-error': (args) => console.error('[renderer-error]', args[0]),
  'mt::get-current-language': async () => {
    const prefs = await invoke<Record<string, unknown>>('preferences_get_all')
    localEmit('mt::current-language', prefs.language || 'en')
  },
  'mt::open-file': async (args) => {
    const path = args[0] as string
    if (!path) return
    const result = await invoke<MarkdownFileResult>('fs_read_markdown', { path })
    localEmit('mt::open-new-tab', result, {}, true)
    invoke('recent_add', { filePath: path }).catch(() => {})
  },
  'mt::open-file-by-window-id': async (args) => {
    const path = args[1] as string
    if (!path) return
    const result = await invoke<MarkdownFileResult>('fs_read_markdown', { path })
    localEmit('mt::open-new-tab', result, {}, true)
  },
  'mt::editor-selection-changed': (args) => {
    // args: [windowId, { affiliation, isDisabled, isMultiline, isCodeFences, isCodeContent, hasFrontMatter, isLooseListItem }]
    const state = args[1] as Record<string, unknown> | undefined
    if (!state) return
    const affiliation = state.affiliation as Record<string, boolean> | undefined
    const isDisabled = !!state.isDisabled
    const isCodeFences = !!state.isCodeFences
    const isCodeContent = !!state.isCodeContent
    const isMultiline = !!state.isMultiline
    const hasFrontMatter = !!state.hasFrontMatter
    const isLooseListItem = !!state.isLooseListItem

    // Paragraph 菜单 checked（基于 affiliation）
    const paragraphIds = [
      'paragraphMenuEntry', 'heading1MenuItem', 'heading2MenuItem', 'heading3MenuItem',
      'heading4MenuItem', 'heading5MenuItem', 'heading6MenuItem',
      'upgradeHeadingMenuItem', 'degradeHeadingMenuItem',
      'tableMenuItem', 'codeFencesMenuItem', 'mathBlockMenuItem',
      'quoteBlockMenuItem', 'orderListMenuItem', 'bulletListMenuItem',
      'taskListMenuItem', 'looseListItemMenuItem', 'frontMatterMenuItem',
      'horizontalLineMenuItem'
    ]
    // 先全部 unchecked
    for (const id of paragraphIds) {
      invoke('menu_set_checked', { id, checked: false }).catch(() => {})
    }
    // 根据 affiliation 恢复 checked
    if (affiliation) {
      const affMap: Record<string, string> = {
        ul: 'bulletListMenuItem', ol: 'orderListMenuItem', task: 'taskListMenuItem',
        blockquote: 'quoteBlockMenuItem', pre: 'codeFencesMenuItem',
        math: 'mathBlockMenuItem', table: 'tableMenuItem',
        h1: 'heading1MenuItem', h2: 'heading2MenuItem', h3: 'heading3MenuItem',
        h4: 'heading4MenuItem', h5: 'heading5MenuItem', h6: 'heading6MenuItem',
        hr: 'horizontalLineMenuItem', frontmatter: 'frontMatterMenuItem'
      }
      for (const [block, menuId] of Object.entries(affMap)) {
        if (affiliation[block]) {
          invoke('menu_set_checked', { id: menuId, checked: true }).catch(() => {})
        }
      }
    }
    if (isLooseListItem) {
      invoke('menu_set_checked', { id: 'looseListItemMenuItem', checked: true }).catch(() => {})
    }

    // Paragraph 菜单 enabled
    const paragraphEnabled = !isDisabled
    for (const id of paragraphIds) {
      invoke('menu_set_enabled', { id, enabled: paragraphEnabled }).catch(() => {})
    }

    // Format 菜单：代码围栏内禁用全部
    const formatIds = [
      'hyperlinkMenuItem', 'imageMenuItem', 'strongMenuItem', 'emphasisMenuItem',
      'inlineCodeMenuItem', 'inlineMathMenuItem', 'strikeMenuItem',
      'highlightMenuItem', 'superscriptMenuItem', 'subscriptMenuItem',
      'clearFormatMenuItem'
    ]
    if (isCodeFences) {
      for (const id of formatIds) {
        invoke('menu_set_enabled', { id, enabled: false }).catch(() => {})
      }
      if (isCodeContent && affiliation && Object.keys(affiliation).some(b => /code$/.test(b))) {
        invoke('menu_set_enabled', { id: 'codeFencesMenuItem', enabled: true }).catch(() => {})
        invoke('menu_set_checked', { id: 'codeFencesMenuItem', checked: true }).catch(() => {})
      }
    } else {
      for (const id of formatIds) {
        invoke('menu_set_enabled', { id, enabled: true }).catch(() => {})
      }
    }

    // 多行选区：禁用 link/image
    if (isMultiline && !isCodeFences) {
      invoke('menu_set_enabled', { id: 'hyperlinkMenuItem', enabled: false }).catch(() => {})
      invoke('menu_set_enabled', { id: 'imageMenuItem', enabled: false }).catch(() => {})
    }

    // 非 list 内禁用 looseListItem; 已有 front-matter 时禁用 frontMatterMenuItem
    if (!affiliation?.ul && !affiliation?.ol && !affiliation?.task) {
      invoke('menu_set_enabled', { id: 'looseListItemMenuItem', enabled: false }).catch(() => {})
    }
    if (hasFrontMatter) {
      invoke('menu_set_enabled', { id: 'frontMatterMenuItem', enabled: false }).catch(() => {})
    }
  },
  'mt::update-line-ending-menu': (args) => {
    // args: [windowId, lineEnding]
    const lineEnding = args[1] as string | undefined
    invoke('menu_set_checked', { id: 'crlfLineEndingMenuEntry', checked: lineEnding === 'crlf' }).catch(() => {})
    invoke('menu_set_checked', { id: 'lfLineEndingMenuEntry', checked: lineEnding === 'lf' }).catch(() => {})
  },
  'mt::update-format-menu': (args) => {
    // args: [windowId, { strong?, emphasis?, inlineCode?, ... }]
    const formats = args[1] as Record<string, boolean> | undefined
    const formatMenuIdMap: Record<string, string> = {
      strong: 'strongMenuItem', em: 'emphasisMenuItem', inline_code: 'inlineCodeMenuItem',
      inline_math: 'inlineMathMenuItem', del: 'strikeMenuItem', mark: 'highlightMenuItem',
      sup: 'superscriptMenuItem', sub: 'subscriptMenuItem', a: 'hyperlinkMenuItem',
      img: 'imageMenuItem', clear: 'clearFormatMenuItem'
    }
    for (const id of Object.values(formatMenuIdMap)) {
      invoke('menu_set_checked', { id, checked: false }).catch(() => {})
    }
    if (formats) {
      for (const [fmt, menuId] of Object.entries(formatMenuIdMap)) {
        if (formats[fmt]) {
          invoke('menu_set_checked', { id: menuId, checked: true }).catch(() => {})
        }
      }
    }
  },
  'mt::update-sidebar-menu': (args) => {
    // args: [windowId, visible]
    const visible = !!args[1]
    invoke('menu_set_checked', { id: 'sideBarMenuItem', checked: visible }).catch(() => {})
  },
  'mt::window::drop': async (args) => {
    const fileList = args[0] as string[]
    if (!fileList) return
    for (const path of fileList) {
      if (path.endsWith('.md')) {
        const result = await invoke<MarkdownFileResult>('fs_read_markdown', { path })
        localEmit('mt::open-new-tab', result, {}, true)
      }
    }
  },
  'mt::select-default-directory-to-open': async () => {
    const dir = await invoke<string | null>('dialog_open_directory')
    if (dir) localEmit('mt::open-default-directory', dir)
  },
  'mt::ask-for-open-project-in-sidebar': async () => {
    const dir = await invoke<string | null>('dialog_open_directory')
    if (dir) localEmit('mt::open-directory', dir)
  },
  'mt::ask-for-modify-image-folder-path': () => {},
  'mt::set-user-data': () => {},
  'mt::keybinding-debug-dump-keyboard-info': () => invoke('keybinding_dump_keyboard_info'),
  // === Recent Documents IPC 映射 ===
  'mt::add-recently-used-document': async (args) => {
    const filePath = args[0] as string
    if (!filePath) return
    try { await invoke('recent_add', { filePath }) } catch (e) { console.warn('[tauri-bridge] recent_add failed:', e) }
  },
  'menu-add-recently-used': async (args) => {
    const filePath = args[0] as string
    if (!filePath) return
    try { await invoke('recent_add', { filePath }) } catch (e) { console.warn('[tauri-bridge] recent_add failed:', e) }
  },
  'menu-clear-recently-used': async () => {
    try { await invoke('recent_clear') } catch (e) { console.warn('[tauri-bridge] recent_clear failed:', e) }
  },
}

// Tauri renderer emit 不回自身；send 映射函数完成 invoke 后用 localEmit 模拟 main→renderer event。
const localListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()

// ─── 保存自反馈抑制 ─────────────────────────────────────────
// 问题：markdown_save 写盘 → notify watcher 检测变更 → emit('mt::update-file')
//       → LISTEN_FOR_FILE_CHANGE 把 isSaved 改回 false（自反馈循环）
// 修复：保存成功后 1.5 秒内忽略同路径的 mt::update-file 事件。
// 1.5s 覆盖 watcher 500ms 防抖 + 文件系统通知延迟 + 安全余量。
const SAVED_PATH_SUPPRESS_MS = 1500
const recentlySavedPaths = new Map<string, number>()

/** 记录一个刚保存的路径，在 SAVED_PATH_SUPPRESS_MS 内抑制其 mt::update-file 事件 */
const markPathAsSaved = (path: string): void => {
  const normalized = pathe.normalize(path).toLowerCase()
  recentlySavedPaths.set(normalized, Date.now())
  // 1.5 秒后自动清理，避免 Map 无限增长
  setTimeout(() => {
    const ts = recentlySavedPaths.get(normalized)
    if (ts && Date.now() - ts >= SAVED_PATH_SUPPRESS_MS) {
      recentlySavedPaths.delete(normalized)
    }
  }, SAVED_PATH_SUPPRESS_MS + 100)
}

/** 检查路径是否在保存抑制期内 */
const isPathInSaveSuppress = (path: string): boolean => {
  const normalized = pathe.normalize(path).toLowerCase()
  const ts = recentlySavedPaths.get(normalized)
  if (!ts) return false
  if (Date.now() - ts >= SAVED_PATH_SUPPRESS_MS) {
    recentlySavedPaths.delete(normalized)
    return false
  }
  return true
}

const localEmit = (channel: string, ...args: unknown[]): void => {
  const listeners = localListeners.get(channel)
  if (listeners) {
    listeners.forEach(fn => fn({ __local: true }, ...args))
  }
}
export { localEmit }


// string | Uint8Array → number[]（Rust 端 Vec<u8> 通过 serde 接受数组）
const toBytes = (data: unknown): number[] | string => {
  if (data instanceof Uint8Array) return Array.from(data)
  if (typeof data === 'string') return data
  return data as string
}

// 当前窗口 label（Rust window commands 需要）；从 URL ?wid= 取或默认 main
const currentLabel = (): string => {
  const params = new URLSearchParams(globalThis.location?.search || '')
  const type = params.get('type')
  if (type === 'settings') return 'settings'
  return 'main'
}

const noop = (): void => {}


// 只包含编辑器能正确打开和渲染的 Markdown 文件类型，不含纯文本
const MARKDOWN_EXTENSIONS = [
  'markdown', 'mdown', 'mkdn', 'md', 'mkd', 'mdwn', 'mdtxt', 'mdtext', 'mdx', 'mmd', 'text', 'txt'
] as const

const MARKDOWN_INCLUSIONS = MARKDOWN_EXTENSIONS.map((e) => `*.${e}`)

const hasMarkdownExtension = (filename: string): boolean => {
  if (!filename || typeof filename !== 'string') return false
  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
}

const isChildOfDirectory = (dir: string, child: string): boolean => {
  if (!dir || !child) return false
  const relative = pathe.relative(dir, child)
  return !!relative && !relative.startsWith('..') && !pathe.isAbsolute(relative)
}

const isSamePathSync = (pathA: string, pathB: string, isNormalized = false): boolean => {
  if (!pathA || !pathB) return false
  const a = isNormalized ? pathA : pathe.normalize(pathA)
  const b = isNormalized ? pathB : pathe.normalize(pathB)
  return a === b || a.toLowerCase() === b.toLowerCase()
}

const fileUtils = {
  isFile: (p: string) => invoke<boolean>('fs_is_file', { path: p }),
  isDirectory: (p: string) => invoke<boolean>('fs_is_directory', { path: p }),
  emptyDir: (p: string) => invoke('fs_empty_dir', { path: p }),
  copy: (src: string, dest: string) => invoke('fs_copy', { src, dest }),
  ensureDir: (p: string) => invoke('fs_ensure_dir', { path: p }),
  outputFile: (p: string, data: string | Uint8Array) =>
    invoke('fs_output_file', { path: p, data: toBytes(data) }),
  move: (src: string, dest: string) => invoke('fs_move', { src, dest }),
  stat: (p: string) => invoke('fs_stat', { path: p }),
  writeFile: (p: string, data: string | Uint8Array) =>
    invoke('fs_write_file', { path: p, data: toBytes(data) }),
  readFile: (p: string, encoding?: string) =>
    invoke('fs_read_file', { path: p, encoding }),
  pathExists: (p: string) => invoke<boolean>('fs_path_exists', { path: p }),
  unlink: (p: string) => invoke('fs_unlink', { path: p }),
  readdir: (p: string) => invoke<string[]>('fs_readdir', { path: p }),
  isExecutable: (p: string) => invoke<boolean>('fs_is_executable', { path: p }),
  isChildOfDirectory,
  hasMarkdownExtension,
  isSamePathSync,
  isImageFile: (p: string) => invoke<boolean>('paths_is_image', { path: p }),
  MARKDOWN_INCLUSIONS
}


type IpcListener = (event: unknown, ...args: unknown[]) => void

// renderer 频繁调用但 Tauri 无需处理的 channel（Electron main 进程内部状态同步）
const NOOP_CHANNELS = new Set<string>([])

// invoke channel 映射：update-buffer-state → buffer_save
const INVOKE_BUFFER_MAP: Record<string, { cmd: string; map: ArgMapper }> = {
  'update-buffer-state': { cmd: 'buffer_save', map: ([state]) => ({ state }) }
}

const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const entry = INVOKE_CHANNEL_MAP[channel]
    if (entry) {
      const params = entry.map(args)
      return params ? invoke(entry.cmd, params) : invoke(entry.cmd)
    }
    const bufEntry = INVOKE_BUFFER_MAP[channel]
    if (bufEntry) {
      const params = bufEntry.map(args)
      return params ? invoke(bufEntry.cmd, params) : invoke(bufEntry.cmd)
    }
    if (NOOP_CHANNELS.size > 0 && NOOP_CHANNELS.has(channel)) return null
    console.warn('[tauri-bridge] unmapped ipcRenderer.invoke channel:', channel)
    return null
  },
  send: (channel: string, ...args: unknown[]): void => {
    const emitFn = SEND_CHANNEL_EMIT_MAP[channel]
    if (emitFn) {
      Promise.resolve(emitFn(args)).catch((e) => console.warn('[tauri-bridge] send error', channel, e))
      return
    }
    // 其它 send 多为窗口控制/菜单事件；转 emit 让 Rust 端按需监听，未监听则丢弃
    emit(`renderer:${channel}`, args).catch(noop)
  },
  sendSync: <T = unknown>(channel: string, ..._args: unknown[]): T => {
    const fn = SENDSYNC_CHANNEL_MAP[channel]
    return (fn ? null : null) as unknown as T
  },
  on: (channel: string, listener: IpcListener): (() => void) => {
    let unlisten: (() => void) = noop
    let cancelled = false
    listen(channel, (event) => {
      if (cancelled) return
      // 保存自反馈抑制：mt::update-file 中 pathname 在抑制期内的丢弃
      if (channel === 'mt::update-file' && event.payload) {
        const payload = event.payload as { change?: { pathname?: string } }
        const pathname = payload?.change?.pathname
        if (pathname && isPathInSaveSuppress(pathname)) {
          return // 丢弃保存操作自身的文件变更通知
        }
      }
      listener(event, (event.payload as unknown) === undefined ? null : event.payload)
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((e) => console.warn('[tauri-bridge] listen failed', channel, e))

    // 同时注册到本地 listener 表，让 localEmit 能触发
    let set = localListeners.get(channel)
    if (!set) {
      set = new Set()
      localListeners.set(channel, set)
    }
    set.add(listener)

    return () => {
      cancelled = true
      unlisten()
      set?.delete(listener)
    }
  },
  once: (channel: string, listener: IpcListener): (() => void) => {
    let unlisten: (() => void) = noop
    let cancelled = false
    let fired = false
    listen(channel, (event) => {
      if (fired || cancelled) return
      fired = true
      listener(event, (event.payload as unknown) === undefined ? null : event.payload)
      unlisten()
    })
      .then((fn) => {
        if (cancelled || fired) fn()
        else unlisten = fn
      })
      .catch((e) => console.warn('[tauri-bridge] listen(once) failed', channel, e))
    return () => {
      cancelled = true
      unlisten()
    }
  },
  off: noop,
  removeListener: noop,
  removeAllListeners: noop,
  postMessage: noop
}

const shell = {
  openExternal: (url: string) => invoke('shell_open_external', { url }),
  openPath: (fullPath: string) => invoke('shell_open_path', { path: fullPath }),
  showItemInFolder: (fullPath: string) => invoke('shell_show_item', { path: fullPath })
}

const clipboard = {
  writeText: (text: string) => invoke('clipboard_write_text', { text }),
  readText: () => invoke<string>('clipboard_read_text'),
  guessFilePath: () => invoke('clipboard_guess_file_path')
}

const webFrame = {
  setZoomFactor: (factor: number) => {
    if (typeof factor === 'number' && factor > 0) {
      import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
        getCurrentWebview().setZoom(factor).catch((e: unknown) => console.warn('[tauri-bridge] setZoom failed:', e))
      })
    }
  },
  setZoomLevel: (level: number) => {
    // Tauri setZoom 用 factor (1.0=100%)，Electron webFrame.setZoomLevel 用 level (0=100%, ±0.2 per step)
    const factor = 1 + level * 0.2
    if (factor > 0) {
      import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
        getCurrentWebview().setZoom(factor).catch((e: unknown) => console.warn('[tauri-bridge] setZoom failed:', e))
      })
    }
  },
  getZoomFactor: () => 1,
  getZoomLevel: () => 0
}

const webUtils = {
  getPathForFile: (_file: File): string => ''
}

// process：Bundled 库（@hfelix/electron-localshortcut 等）在 import 时读 process.platform
const processShim = {
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64' as string,
  versions: { chrome: '120', electron: '42.0', node: '20.19.0' },
  env: { ...(globalThis as Record<string, unknown>).__env || {} } as Record<string, string>,
  resourcesPath: '',
  cwd: () => '',
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    Promise.resolve().then(() => fn(...args))
  }
}

// paths：boot_info_async 在运行时填充；启动期提供空对象让 RendererPaths 构造不抛
const paths = {
  userData: '',
  documents: '',
  appData: '',
  temp: '',
  home: '',
  cwd: '',
  resources: '',
  ripgrepBinary: 'rg',
  logs: ''
}

// windowControl：Rust 端只实现了 window_close / window_is_maximized / window_toggle_always_on_top
// 其余通过 emit 转发，Rust setup 钩子按需监听
const windowControl = {
  minimize: () => getCurrentWindow().minimize(),
  maximize: () => getCurrentWindow().maximize(),
  unmaximize: () => getCurrentWindow().unmaximize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  setFullScreen: (flag: boolean) => getCurrentWindow().setFullscreen(flag),
  toggleFullScreen: async () => {
    const win = getCurrentWindow()
    const isFull = await win.isFullscreen()
    await win.setFullscreen(!isFull)
  },
  isMaximized: () => invoke<boolean>('window_is_maximized', { label: currentLabel() }),
  isFullScreen: () => invoke<boolean>('win_is_fullscreen', { label: currentLabel() }),
  popupMenu: (template: unknown, position?: { x: number; y: number }) => {
    const items = template as Array<Record<string, unknown>>
    if (!items) return
    const menu = document.createElement('div')
    menu.style.cssText =
      'position:fixed;z-index:99999;background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,0.2);padding:4px 0;min-width:180px;font-size:13px;font-family:sans-serif'
    for (const item of items) {
      if (item.type === 'separator' || item.isSeparator) {
        const sep = document.createElement('div')
        sep.style.cssText = 'height:1px;background:#e0e0e0;margin:4px 0'
        menu.appendChild(sep)
        continue
      }
      if (item.visible === false) continue
      const el = document.createElement('div')
      el.textContent = String(item.label || '')
      el.style.cssText = `padding:6px 16px;cursor:pointer;white-space:nowrap;${
        item.enabled === false ? 'opacity:0.4;cursor:default' : ''
      }`
      el.onmouseenter = () => { if (item.enabled !== false) el.style.background = '#e8f0fe' }
      el.onmouseleave = () => { el.style.background = '' }
      el.onclick = () => {
        if (item.enabled === false) return
        localEmit('mt::menu::click', { id: item.id, windowId: 0 })
        close()
      }
      menu.appendChild(el)
    }
    const close = () => {
      menu.remove()
      localEmit('mt::menu::closed')
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKeydown, true)
    }
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    const x = position?.x ?? 0
    const y = position?.y ?? 0
    menu.style.left = x + 'px'
    menu.style.top = y + 'px'
    document.body.appendChild(menu)
    setTimeout(() => {
      document.addEventListener('click', close, { once: true })
      document.addEventListener('keydown', onKeydown, true)
    }, 0)
  },
  popupApplicationMenu: (position?: { x: number; y: number }) =>
    emit('renderer:mt::menu::popup-application', { position })
}

const electron = {
  ipcRenderer,
  shell,
  clipboard,
  webFrame,
  webUtils,
  process: processShim,
  paths,
  isUpdatable: false,
  windowControl
}


const rgPath = 'rg'

const commandExists = {
  exists: (name: string) => invoke<boolean>('cmd_exists', { command: name })
}

const i18nUtils = {
  loadTranslations: (language: string) => invoke('i18n_load', { locale: language })
}

type RipgrepHandler = (payload: unknown) => void

const ripgrep = {
  start: (req: unknown) => invoke<string>('rg_start', { req }),
  cancel: (searchId: string) => invoke('rg_cancel', { searchId }),
  onMatch: (handler: RipgrepHandler) => subscribeRg('rg_match', handler),
  onProgress: (handler: RipgrepHandler) => subscribeRg('rg_progress', handler),
  onDone: (handler: RipgrepHandler) => subscribeRg('rg_done', handler),
  onError: (handler: RipgrepHandler) => subscribeRg('rg_error', handler),
  onCancelled: (handler: RipgrepHandler) => subscribeRg('rg_cancelled', handler)
}

const subscribeRg = (event: string, handler: RipgrepHandler): (() => void) => {
  let unlisten: () => void = noop
  let cancelled = false
  listen(event, (e) => {
    if (!cancelled) handler(e.payload)
  })
    .then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    .catch((e) => console.warn('[tauri-bridge] rg listen failed', event, e))
  return () => {
    cancelled = true
    unlisten()
  }
}

const uploader = {
  uploadImage: (req: unknown) => invoke<string>('uploader_upload', { req })
}

const fonts = {
  list: () => invoke<string[]>('fonts_list')
}

// path：渲染层 `window.path` 提供 Node path 兼容 API（pathe 实现）
const path = {
  basename: (...args: Parameters<typeof pathe.basename>) => pathe.basename(...args),
  dirname: (...args: Parameters<typeof pathe.dirname>) => pathe.dirname(...args),
  extname: (...args: Parameters<typeof pathe.extname>) => pathe.extname(...args),
  join: (...args: string[]) => pathe.join(...args),
  resolve: (...args: string[]) => pathe.resolve(...args),
  relative: (...args: Parameters<typeof pathe.relative>) => pathe.relative(...args),
  isAbsolute: (...args: Parameters<typeof pathe.isAbsolute>) => pathe.isAbsolute(...args),
  normalize: (...args: Parameters<typeof pathe.normalize>) => pathe.normalize(...args),
  parse: (...args: Parameters<typeof pathe.parse>) => pathe.parse(...args),
  format: (...args: Parameters<typeof pathe.format>) => pathe.format(...args),
  sep: pathe.sep,
  delimiter: pathe.delimiter
}

const w = globalThis as unknown as Record<string, unknown>

if (!w.electron) w.electron = electron
if (!w.process) w.process = processShim
if (!w.rgPath) w.rgPath = rgPath
if (!w.fileUtils) w.fileUtils = fileUtils
if (!w.path) w.path = path
if (!w.commandExists) w.commandExists = commandExists
if (!w.i18nUtils) w.i18nUtils = i18nUtils
if (!w.ripgrep) w.ripgrep = ripgrep
if (!w.uploader) w.uploader = uploader
if (!w.fonts) w.fonts = fonts
if (!w.marktext) w.marktext = {}

// Electron main 进程在窗口加载后发送 bootstrap-editor；
// Tauri 无此机制，此处等 Vue app 挂载完成后再 emit，触发 SET_INITIALIZED。
// 有 buffer 状态时先 bootstrap（无空标签），再 emit mt::load-state 恢复会话。
const doBootstrap = async () => {
  let hasBuffer = false
  let bufferState: Record<string, unknown> | null = null
  try {
    const loaded = await invoke<Record<string, unknown> | null>('buffer_load')
    if (loaded && loaded.tabs && Array.isArray(loaded.tabs) && loaded.tabs.length > 0) {
      hasBuffer = true
      bufferState = loaded
    }
  } catch (e) {
    console.warn('[tauri-bridge] buffer_load failed, starting fresh:', e)
  }

  console.log('[tauri-bridge] emitting mt::bootstrap-editor, hasBuffer:', hasBuffer)
  localEmit('mt::bootstrap-editor', {
    addBlankTab: !hasBuffer,
    markdownList: [],
    lineEnding: 'lf',
    sideBarVisibility: true,
    tabBarVisibility: true,
    sourceCodeModeEnabled: false
  })

  if (hasBuffer && bufferState) {
    // 稍延迟等 renderer 完成 bootstrap 初始化后再恢复会话
    setTimeout(() => {
      console.log('[tauri-bridge] emitting mt::load-state with', (bufferState as { tabs: unknown[] }).tabs.length, 'tabs')
      localEmit('mt::load-state', bufferState)
    }, 200)
  }
}

// Wait for Vue app to mount (mt::renderer-ready event dispatched by main.ts),
// then emit bootstrap-editor. Fall back to 3s timeout as safety net.
let bootstrapDone = false
const runOnce = () => {
  if (bootstrapDone) return
  bootstrapDone = true
  doBootstrap()
}
window.addEventListener('mt::renderer-ready', runOnce, { once: true })
setTimeout(runOnce, 3000) // safety fallback

export { electron, fileUtils, processShim as process, rgPath, commandExists, i18nUtils, ripgrep, uploader, fonts, path }

// Single-instance: when a second instance launches with a file argument, the
// Rust single-instance plugin emits this event so the running instance opens it.
listen('mt::open-file-from-second-instance', (event) => {
  const filePath = event.payload as string
  if (filePath) {
    window.electron.ipcRenderer.send('mt::open-file', filePath, {})
  }
}).catch((e) => console.warn('[tauri-bridge] single-instance listen failed', e))

// P1-13 fix: Bridge Rust `preferences-changed` (Tauri app.emit) to the
// renderer's existing `mt::user-preference` channel. In Electron, the
// WindowManager listened on `broadcast-preferences-changed` and forwarded
// partial prefs to each window as `mt::user-preference`. The Tauri port's
// Rust side broadcasts `preferences-changed` via app.emit(), but no renderer
// listener existed. Reconnect the chain:
//   preferences_set/reset → app.emit("preferences-changed") → localEmit("mt::user-preference")
//   → preferences store SET_USER_PREFERENCE() merges into Pinia state.
listen('preferences-changed', (event) => {
  const prefs = event.payload as Record<string, unknown> | null
  if (prefs && typeof prefs === 'object') {
    localEmit('mt::user-preference', prefs)
  }
}).catch((e) => console.warn('[tauri-bridge] preferences-changed listen failed', e))

// P2-22 fix: Bridge Rust `format_link_click` → `app.emit("mt::open-new-tab")` to the
// renderer's existing `mt::open-new-tab` channel. When a user clicks a .md link in the
// editor, the Rust command reads the file and emits this event to open a new tab.
listen('mt::open-new-tab', (event) => {
  const result = event.payload as MarkdownFileResult | null
  if (result) {
    localEmit('mt::open-new-tab', result, {}, true)
  }
}).catch((e) => console.warn('[tauri-bridge] mt::open-new-tab listen failed', e))

// P2-23 fix: Bridge Rust `mt::open-recent-file` event (from "Open Recent" menu click)
// to the renderer's `mt::open-file` channel, which reads the file and opens a tab.
listen<string>('mt::open-recent-file', (event) => {
  const filePath = event.payload
  if (filePath) {
    // 直接通过已有的 mt::open-file send 处理器打开文件
    ipcRenderer.send('mt::open-file', filePath)
  }
}).catch((e) => console.warn('[tauri-bridge] mt::open-recent-file listen failed', e))

// P0 fix: Initialize global keyboard shortcut handler.
// Tauri 2 native menu accelerators don't intercept WebView key events;
// this bridge captures keydown events and dispatches to handleMenuClick().
// Only initialize for the editor window (not settings).
if (!isSettings) {
  import('./keyboardShortcuts').then(({ initKeyboardShortcuts }) => {
    initKeyboardShortcuts()
    console.log('[tauri-bridge] keyboard shortcuts initialized')
  }).catch((e) => console.warn('[tauri-bridge] keyboardShortcuts import failed:', e))
}
