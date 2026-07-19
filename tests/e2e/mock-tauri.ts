import type { Page } from '@playwright/test'

export type MockOverride = Record<string, unknown>

export const MOCK_INVOKE_RESPONSES: Record<string, unknown> = {
  fs_is_file: false,
  fs_is_directory: true,
  fs_path_exists: false,
  fs_read_file: '# Welcome to MarkTEXT\n\nThis is a test document.\n\n- item one\n- item two\n',
  fs_readdir: [],
  fs_stat: {
    size: 100,
    mtimeMs: 0,
    ctimeMs: 0,
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
  },
  preferences_get_all: {
    autoSave: false,
    autoSaveDelay: 5000,
    titleBarStyle: 'custom',
    openFilesInNewWindow: false,
    openFolderInNewWindow: false,
    zoom: 1.0,
    hideScrollbar: false,
    wordWrapInToc: false,
    fileSortBy: 'created',
    fileSortOrder: 'asc',
    startUpAction: 'restoreAll',
    restoreLayoutState: true,
    defaultDirectoryToOpen: '',
    lastOpenedFolder: '',
    treePathExcludePatterns: [],
    language: 'en',
    editorFontFamily: 'Open Sans',
    fontSize: 16,
    lineHeight: 1.6,
    codeFontSize: 14,
    codeFontFamily: 'DejaVu Sans Mono',
    codeBlockLineNumbers: false,
    trimUnnecessaryCodeBlockEmptyLines: true,
    wrapCodeBlocks: false,
    editorLineWidth: '',
    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    endOfLine: 'default',
    defaultEncoding: 'utf8',
    autoGuessEncoding: true,
    autoNormalizeLineEndings: false,
    trimTrailingNewline: 2,
    textDirection: 'ltr',
    hideQuickInsertHint: false,
    imageInsertAction: 'path',
    imagePreferRelativeDirectory: false,
    imageRelativeDirectoryBase: 'file',
    imageRelativeDirectoryName: 'assets',
    hideLinkPopup: false,
    autoCheck: false,
    preferLooseListItem: true,
    bulletListMarker: '-',
    orderListDelimiter: '.',
    preferHeadingStyle: 'atx',
    tabSize: 4,
    listIndentation: 1,
    frontmatterType: '-',
    superSubScript: false,
    footnote: false,
    isHtmlEnabled: true,
    isGitlabCompatibilityEnabled: false,
    sequenceTheme: 'hand',
    plantumlServer: 'https://www.plantuml.com/plantuml',
    theme: 'light',
    followSystemTheme: true,
    lightModeTheme: 'light',
    darkModeTheme: 'dark',
    customCss: '',
    spellcheckerEnabled: false,
    spellcheckerNoUnderline: false,
    spellcheckerLanguage: 'en-US',
    sideBarVisibility: true,
    tabBarVisibility: false,
    sourceCodeModeEnabled: false,
    openedFilesInSidebar: true,
    searchExclusions: [],
    searchMaxFileSize: '',
    searchIncludeHidden: false,
    searchNoIgnore: false,
    searchFollowSymlinks: true,
    watcherUsePolling: false,
  },
  preferences_set: true,
  preferences_get: null,
  preferences_reset: {},
  preferences_get_schema: { type: 'object' },
  boot_info_async: {
    platform: 'win32',
    arch: 'x86_64',
    versions: { rust: '1.92', tauri: '2' },
    paths: {
      resources: '',
      userData: 'C:\\UserData',
      cwd: 'C:\\cwd',
      ripgrepBinary: 'rg',
    },
    isUpdatable: false,
    MARKDOWN_INCLUSIONS: ['*.md', '*.markdown', '*.txt'],
  },
  cmd_exists: false,
  fonts_list: [],
  i18n_supported: ['en', 'zh', 'ja'],
  i18n_is_supported: true,
  i18n_load: {},
  win_is_fullscreen: false,
  window_is_maximized: false,
  window_close: null,
  window_new_editor: null,
  window_open_settings: null,
  window_toggle_always_on_top: null,
  spellchecker_get_available_dictionaries: ['en-US'],
  spellchecker_set_enabled: true,
  spellchecker_get_custom_dictionary_words: [],
  spellchecker_remove_word: null,
  spellchecker_switch_language: null,
  dialog_open_file: null,
  dialog_open_directory: null,
  ask_for_image_path: null,
  updater_check_latest: { has_update: false, latest_version: '0.1.0', download_url: '', notes: '' },
  clipboard_read_text: '',
  clipboard_write_text: null,
  clipboard_guess_file_path: null,
  shell_open_external: null,
  shell_open_path: null,
  shell_show_item: null,
  rg_start: '',
  paths_is_image: false,
  paths_is_same: false,
  uploader_upload: '',
  fs_write_file: null,
  fs_output_file: null,
  fs_unlink: null,
  fs_copy: null,
  fs_move: null,
  fs_ensure_dir: null,
  fs_empty_dir: null,
  fs_is_executable: false,
  fs_trash_item: null,
  keybinding_dump_keyboard_info: {},
}

export function buildMockScript(overrides: MockOverride = {}): string {
  const responses = { ...MOCK_INVOKE_RESPONSES, ...overrides }
  const json = JSON.stringify(responses)
  return `
(function installTauriMock() {
  var responses = ${json};
  var callbacks = new Map();
  var eventListeners = new Map();
  var eventSeq = 0;

  function transformCallback(cb, once) {
    var id = ++eventSeq;
    callbacks.set(id, function(payload) {
      try { cb && cb(payload); } catch (e) { console.warn('[mock-tauri] callback error', e); }
      if (once) callbacks.delete(id);
    });
    return id;
  }
  function unregisterCallback(id) { callbacks.delete(id); }
  function runCallback(id, data) {
    var cb = callbacks.get(id);
    if (cb) cb(data);
  }

  function resolveResponse(cmd, args) {
    if (Object.prototype.hasOwnProperty.call(responses, cmd)) {
      var v = responses[cmd];
      return v;
    }
    if (cmd === 'plugin:event|listen') {
      var evt = args && args.event;
      var handlerId = args && args.handler;
      if (evt && handlerId !== undefined) {
        if (!eventListeners.has(evt)) eventListeners.set(evt, []);
        eventListeners.get(evt).push(handlerId);
      }
      return handlerId;
    }
    if (cmd === 'plugin:event|unlisten') {
      var evt2 = args && args.event;
      var id2 = args && args.id;
      var arr = eventListeners.get(evt2);
      if (arr) {
        var idx = arr.indexOf(id2);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return null;
    }
    if (cmd === 'plugin:event|emit') {
      var evt3 = args && args.event;
      var payload = args && args.payload;
      var arr3 = eventListeners.get(evt3) || [];
      arr3.forEach(function(handlerId) {
        Promise.resolve().then(function() {
          runCallback(handlerId, { event: evt3, payload: payload, id: handlerId });
        });
      });
      return null;
    }
    console.warn('[mock-tauri] unhandled invoke:', cmd, args);
    return null;
  }

  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.invoke = function(cmd, args, _options) {
    try { return Promise.resolve(resolveResponse(cmd, args)); }
    catch (e) { return Promise.reject(e); }
  };
  window.__TAURI_INTERNALS__.transformCallback = transformCallback;
  window.__TAURI_INTERNALS__.unregisterCallback = unregisterCallback;
  window.__TAURI_INTERNALS__.runCallback = runCallback;
  window.__TAURI_INTERNALS__.callbacks = callbacks;
  window.__TAURI_INTERNALS__.metadata = {
    currentWindow: { label: 'main' },
    currentWebview: { windowLabel: 'main', label: 'main' },
  };
  window.__TAURI_INTERNALS__.convertFileSrc = function(filePath, protocol) {
    return 'http://' + (protocol || 'asset') + '.localhost/' + encodeURIComponent(filePath);
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = function(event, id) {
    var arr = eventListeners.get(event);
    if (arr) {
      var idx = arr.indexOf(id);
      if (idx !== -1) arr.splice(idx, 1);
    }
  };

  window.__MOCK_INVOKE_LOG__ = [];
  window.__MOCK_INVOKE_OVERRIDE__ = function(cmd, value) { responses[cmd] = value; };
  window.__MOCK_INVOKE_RECORD__ = function() {
    var orig = window.__TAURI_INTERNALS__.invoke;
    var log = window.__MOCK_INVOKE_LOG__;
    window.__TAURI_INTERNALS__.invoke = function(cmd, args, opts) {
      log.push({ cmd: cmd, args: args });
      return orig.call(this, cmd, args, opts);
    };
  };

  console.log('[mock-tauri] installed. registered cmds:', Object.keys(responses).length);
})();
`
}

export async function injectTauriMock(page: Page, overrides: MockOverride = {}): Promise<void> {
  await page.addInitScript(buildMockScript(overrides))
}

export async function setMockResponse(page: Page, cmd: string, value: unknown): Promise<void> {
  await page.evaluate(({ cmd, value }) => {
    ;(window as unknown as { __MOCK_INVOKE_OVERRIDE__: (c: string, v: unknown) => void }).__MOCK_INVOKE_OVERRIDE__(cmd, value)
  }, { cmd, value })
}

export async function startRecordingInvokes(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __MOCK_INVOKE_RECORD__: () => void }).__MOCK_INVOKE_RECORD__()
  })
}

export async function getRecordedInvokes(page: Page): Promise<Array<{ cmd: string; args: unknown }>> {
  return page.evaluate(() => {
    return (window as unknown as { __MOCK_INVOKE_LOG__: Array<{ cmd: string; args: unknown }> }).__MOCK_INVOKE_LOG__
  })
}

export async function emitTauriEvent(page: Page, event: string, payload?: unknown): Promise<void> {
  await page.evaluate(({ event, payload }) => {
    return window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload })
  }, { event, payload })
}
