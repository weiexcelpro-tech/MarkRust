---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'ebd087ba-67e5-4c1f-9c3d-7147d334dac4'
  PropagateID: 'ebd087ba-67e5-4c1f-9c3d-7147d334dac4'
  ReservedCode1: '2a754336-0744-4efa-8c9a-51a088ad9827'
  ReservedCode2: '2a754336-0744-4efa-8c9a-51a088ad9827'
---

---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'fc6eacc1-b2ac-42f0-aff0-7d07e71e68c5'
  PropagateID: 'fc6eacc1-b2ac-42f0-aff0-7d07e71e68c5'
  ReservedCode1: '1e17b8ca-ae26-480a-852c-a28f589b7456'
  ReservedCode2: '1e17b8ca-ae26-480a-852c-a28f589b7456'
---

# MarkText Electron → Tauri 2 迁移审计报告

> 生成日期：2026-07-08 | 当前版本：1.0.19

## 一、已修复的问题（9 项）

| # | 问题 | 根因 | 修复方案 |
|---|---|---|---|
| 1 | Sidebar 显示空目录 | Tauri 版丢掉了 chokidar 目录扫描机制 | Rust 新增 `fs_list_tree` 命令 + 前端 `OPEN_PROJECT` 接线 |
| 2 | 快捷键全部失效 | `isTextInputTarget` 用过时 `.ag-editor` 类名，muya 实际用 `.mu-editor` | 类名修正 + ALWAYS_FIRE 白名单补全 + 7 个映射 + Ctrl+K 修复 |
| 3 | markdown 不渲染（CSS） | `@muyajs/core` 不含 CSS，原版 muya 有 1912 行 CSS | 复制 3 个 CSS 文件 + main.ts import |
| 4 | CRLF 文件不渲染 | `tauri-bridge.ts` 直接传 `\r\n` 原文给 muya | 5 处 `fs_read_file` 后加 `\r\n→\n` 规范化 |
| 5 | 标签名显示 Untitled-1 | `mt::open-new-tab` payload 缺 filename | 5 处 emit 加 `filename: pathe.basename(path)` |
| 6 | 命令行参数不打开文件 | lib.rs 无 `std::env::args()` 处理 | LaunchFile state + get_launch_file 命令 + main.ts invoke |
| 7 | 双击 .md 弹多个 markrust | 注册表缓存了旧 exe 入口 | 清理 UserChoice/OpenWithList/OpenWithProgids |
| 8 | **原生菜单快捷键全部无效** | Tauri 2 `.accelerator()` 仅在菜单 UI 显示标签，不拦截 WebView2 键盘事件；WebView2 (Chromium) 先消费键盘事件 | 新增 `keyboardShortcuts.ts`：全局 keydown capture-phase 监听器 → `SHORTCUT_MAP` 查表映射 → `handleMenuClick(id)` + `preventDefault/stopPropagation`；含 `isTextInputTarget()` + `ALWAYS_FIRE` 白名单，避免在 INPUT/TEXTAREA 中拦截编辑类快捷键 |
| 9 | **最近文件菜单缺失** | `recentdocuments` 通道 noop | Rust `recent_add/get/clear` + menu.rs `build_open_recent_menu()` 子菜单 + tauri-bridge 接线 |

## 二、遗漏项审计

### P0 — 核心功能不可用

| # | 遗漏项 | 影响 | 原版逻辑 | Tauri 版状态 |
|---|---|---|---|---|
| 1 | **保存不写盘** | Ctrl+S 完全无效 | `mt::response-file-save` → 主进程 `writeMarkdownFile`（行尾还原+BOM+编码） | shim 落到 fallback emit，Rust **无监听** |
| 2 | **另存为不写盘** | Ctrl+Shift+S 无效 | `mt::response-file-save-as` → 对话框 + writeMarkdownFile | 同上，Rust 无监听 |
| 3 | **重命名/移动** | File 菜单 rename/move-to 无效 | `mt::rename` / `mt::response-file-move-to` | shim 显式 noop |
| 4 | **导出** | Ctrl+Alt+E 导出 PDF/HTML 无效 | `mt::response-export` → puppeteer/print | shim 显式 noop |
| 5 | **打印** | Ctrl+P 无效 | `mt::response-print` → browser print | shim 显式 noop |
| 6 | **单实例检测** | 双击 .md 启动多实例 | `app.requestSingleInstanceLock()` + second-instance 事件 | 无 `tauri-plugin-single-instance` |
| 7 | **文件监听未接线** | 外部修改文件不刷新，sidebar 不响应磁盘变化 | chokidar watcher 初始扫描 + 增量事件 | `watch_file` 命令存在但**前端从未调用**，事件名不匹配 |

### P1 — 重要功能缺失

| # | 遗漏项 | 影响 | 原版逻辑 | Tauri 版状态 |
|---|---|---|---|---|
| 8 | **open-new-tab payload 不完整** | 行尾/编码信息丢失 | `loadMarkdownFile` 返回完整 MarkdownDocument | 硬编码 `isMixedLineEndings:false`，缺 `lineEnding`/`adjustLineEndingOnSave`/`trimTrailingNewline`/`encoding` |
| 9 | **行尾规范化不完整** | lone `\r`（旧 Mac）不处理 | `LINE_ENDING_REG` 同时匹配 `\r\n`/`\r`/`\n` | 只处理 `\r\n` |
| 10 | **会话恢复** | 启动后空白 Untitled | bootstrap 从 bufferedState 恢复 markdownList | 硬编码 `markdownList: []` |
| 11 | **保存后状态反馈** | tab isSaved 永不回 true | `mt::tab-saved` / `mt::set-pathname` | 无源 emit |
| 12 | **应用菜单状态同步** | View 菜单勾选不反映布局 | `mt::view-layout-changed` / `mt::editor-selection-changed` | shim 显式 noop |
| 13 | **跨窗口偏好同步** | 设置窗口改偏好，编辑器不刷新 | `preferences-changed` 事件广播 | Rust emit 但 renderer 不 listen |
| 14 | **剪贴板富文本** | 复制为 HTML（Ctrl+Shift+C）失效 | `clipboard.readHTML/writeHTML` | 只有 readText/writeText |
| 15 | **截图** | 截图功能失效 | `clipboard.readImage()` + `mt::make-screenshot` | shim noop |
| 16 | **NSIS 文件关联** | 安装后 .md 不自动关联 | Electron installer 注册 | tauri.conf.json 无 `fileAssociations` |

### P2 — 体验缺陷

| # | 遗漏项 | 影响 | 状态 |
|---|---|---|---|
| 17 | **tab 关闭不 unwatch** | `mt::window-tab-closed` noop，watcher 泄漏（即便接线） | ✅ 已实现：tauri-bridge.ts 已有 `invoke('unwatch_file', {path})` 调用 + Rust 命令已注册，审计时遗漏 |
| 18 | **快捷键加载** | `mt::request-keybindings` noop，用户自定义快捷键不加载 | ✅ 已修复：Rust `get_keybindings` 命令（Windows 默认键绑定 + 用户覆盖） + tauri-bridge async invoke + localEmit |
| 19 | **右键上下文菜单** | `mt::cm-*` 事件无源 | ✅ 已修复：renderer-side context menu via popupContextMenu，直接 bus.emit 触发 muya 操作 |
| 20 | **拼写菜单** | `mt::spelling-*` 事件无源 | ✅ WebView2 原生支持：WebView2 自带 Chromium Hunspell 拼写检查（红色波浪线+右键建议替换），等价于 Electron 的 `session.*SpellChecker*`。原版 `mt::spelling-replace-misspelling` 事件仅在 Electron 自定义上下文菜单时需要——Tauri 中 WebView2 原生处理替换。Rust stub commands（set_enabled/switch_language/get_dictionaries/remove_word/get_custom_dictionary_words）已存在但未完整实现，Settings UI 语言切换和自定义词典需后续完善 |
| 21 | **图片路径自动补全** | `mt::ask-for-image-auto-path` noop | ✅ 已修复：Rust `image_auto_path` 命令 + tauri-bridge 接线 |
| 22 | **链接点击打开 .md** | `mt::format-link-click` noop | ✅ 已修复：Rust `format_link_click` 命令 + tauri-bridge 接线 |
| 23 | **recentdocuments** | Windows 任务栏右键无「最近文件」 | ✅ 已修复：Rust `recent_add`（MRU 列表，max 12，JSON 持久化）/ `recent_get` / `recent_clear` + menu.rs `build_open_recent_menu()` 子菜单 + tauri-bridge 接线 + `mt::recent-documents-changed` 触发菜单重建 |
| 24 | **CSP 安全策略** | `csp: null`，无内容安全策略 | ✅ 已修复：tauri.conf.json 设置完整 CSP（default-src/img-src/style-src/script-src/font-src/connect-src） |
| 25 | **userData 路径硬编码** | `C:\Users\Lenovo\AppData\...` 换机器失效 | ✅ 已修复：Rust `get_user_data_dir` 命令 + tauri-bridge async IIFE + `__TAURI_USER_DATA_DIR_READY__` Promise |
| 26 | **webFrame zoom** | Ctrl+= / Ctrl+- 缩放 noop | ✅ 已修复：`getCurrentWebview().setZoom()` 替换 noop + 权限 |
| 27 | **bootstrap 800ms 延迟** | 白屏或时序问题 | ✅ 已修复：改为事件驱动 — main.ts 在 `app.mount('#app')` 后 dispatch `mt::renderer-ready`，tauri-bridge 收到后立即 emit bootstrap-editor；3s setTimeout 兜底 |
| 28 | **CheckMenuItem 竞态** | on_menu_event toggle vs renderer set_checked 可能冲突 | ✅ 已修复：移除 on_menu_event 自动 toggle，仅 emit 点击事件，renderer 完全控制 checked 状态 |
| 29 | **多窗口状态恢复** | editor 窗口位置不保存 | ✅ 部分修复（window_state.rs 已有保存/恢复） |
| 30 | **encoding 自动探测** | shim 硬编码 `utf-8`，绕过 autoGuessEncoding 偏好 | ✅ 已修复：Rust `fs_read_markdown` 默认 auto_guess=true，三层检测（BOM→UTF-8验证→chardetng） |

## 三、muya 差异（@muyajs/core vs packages/muya）

| 方面 | 原版 (packages/muya) | Tauri 版 (@muyajs/core) | 状态 |
|---|---|---|---|
| CSS | 随包 3 文件（1912 行） | 不含 CSS | ✅ 已复制修复 |
| contenteditable 类名 | `.ag-editor`（aglio 遗留） | `.mu-editor` | ✅ 已修复 |
| sourceCodeMode | shell 层 UI 切换（v-if） | 同 | ✅ 一致 |
| init() 必须 | 是 | 是 | ✅ 已调用 |
| markRaw | 必须 | 必须 | ✅ 已用 |
| setContent/replaceContent | 区分切文档/保 undo | 同 | ✅ 一致 |
| sourceCodeModeEnabled vs sourceCode | 持久化偏好 vs 运行时状态 | 同 | ✅ 一致 |
| 事件 (json-change 等) | 完整 | 完整 | ✅ 一致 |

## 四、平台差异清单（Windows）

### 已处理（28 项）
- menu accelerator → capture-phase keydown 补偿
- undo/redo PredefinedMenuItem no-op → 自定义 MenuItem
- CheckMenuItem 勾选 → menu_set_checked command（+ removed on_menu_event auto-toggle → renderer 完全控制）
- cargo dist 嵌入 → version 号触发重编译
- 命令行参数 → LaunchFile state
- 文件关联 → 注册表 + get_launch_file
- 路径统一 → replace('\\','/') + pathe
- keytar → keyring crate
- chokidar → notify crate（命令存在，接线缺失）
- CSP 安全策略 → tauri.conf.json 完整 CSP 策略
- userData 路径 → Rust `get_user_data_dir` + async Promise
- 快捷键加载 → Rust `get_keybindings` + async invoke + localEmit
- 拼写检查 → WebView2 原生支持（Chromium Hunspell + 右键建议），等价于 Electron session.SpellChecker
- 等

### 未处理（9 项，见 P0/P1/P2 清单）
- 单实例检测（P0）
- 剪贴板 HTML/RTF/Image（P1）
- NSIS 文件关联注册（P1）
- 等

## 五、实施计划

### 阶段 1：P0 核心功能修复（建议 2-3 天）

1. **Rust 新增 `markdown_save` 命令**：
   - 参数：path, markdown, lineEnding, adjustLineEndingOnSave, encoding, isBom, trimTrailingNewline
   - 逻辑：convertLineEndings（LF→CRLF if adjustLineEndingOnSave）→ BOM 前缀 → encoding_rs encode → fs_write_file
   - 注册到 invoke_handler

2. **tauri-bridge.ts 映射 save 通道**：
   - `mt::response-file-save` → `invoke('markdown_save', {path, markdown, ...})`
   - `mt::response-file-save-as` → 对话框 + invoke
   - `mt::rename` → `invoke('fs_move', {from, to})`
   - 保存成功后 emit `mt::tab-saved` / `mt::set-pathname` 回执

3. **引入 tauri-plugin-single-instance**：
   - Cargo.toml 加依赖
   - lib.rs setup 里 `app.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| { ... }))`
   - second-instance 回调里解析 argv[1] 文件路径 → emit 到已有窗口

4. **接线文件监听**：
   - project.ts `OPEN_PROJECT` 里加 `invoke('watch_file', {path})`
   - 统一事件名：Rust emit `mt::update-file` / `mt::update-object-tree`（匹配前端监听器）
   - 或前端监听 `mt::file-changed` 并补内容加载

### 阶段 2：P1 重要功能（建议 3-5 天）

5. **完善 open-new-tab payload**：
   - Rust `fs_read_file` 新增行尾检测（返回 `{content, lineEnding, isMixedLineEndings, encoding, isBom}`）
   - 或前端实现完整 `loadMarkdownFile` 等价逻辑

6. **会话恢复**：
   - bootstrap 时从 `bufferedState.json` 读 markdownList
   - Rust 新增 `read_buffered_state` / `write_buffered_state` 命令

7. **应用菜单状态同步**：
   - `mt::view-layout-changed` → 调 `menu_set_checked` 更新菜单
   - `mt::editor-selection-changed` → 更新 Format 菜单项 enabled 状态

8. **导出/打印**：
   - 前端用浏览器原生 `window.print()` 替代
   - PDF 导出用 Tauri 的 WebviewWindow + print API

9. **跨窗口偏好同步**：
   - renderer 订阅 `preferences-changed` 事件

### 阶段 3：P2 体验优化（建议 2-3 天）

10. **tab 关闭 unwatch**：`mt::window-tab-closed` → `invoke('unwatch_file', {path})`
11. **webFrame zoom**：改用 `getCurrentWindow().setZoom()`
12. **userData 路径**：改用 `invoke('app_data_dir')` 异步获取
13. **CSP 安全策略**：tauri.conf.json 设置 csp
14. **NSIS 文件关联**：tauri.conf.json 加 `fileAssociations`
15. **bootstrap 延迟**：改用 Tauri ready 事件替代 setTimeout 800ms

### 阶段 4：自动化测试基础设施（持续）

16. **CDP 验证基础设施**（已建立）：
    - `tools/verify/start-with-cdp.ps1`
    - `verify-shortcuts.mjs` / `test-render.mjs` / `verify-filename.mjs`
    - 扩展：verify-save.mjs / verify-watcher.mjs / verify-single-instance.mjs

17. **构建流程标准化**：
    - `Cargo.toml` version 递增触发重编译
    - `cp markrust.exe markrust-X.Y.Z.exe` 版本化
    - 考虑 `beforeBuildCommand` 用 `npx vite build`（绕过 vue-tsc）

## 六、构建教训

| 教训 | 原因 | 解决方案 |
|---|---|---|
| cargo 增量编译不嵌入新 dist | `generate_context!` 宏不跟踪 dist 变化 | 改 Cargo.toml version 触发重编译 |
| `[[bin]] name` 不允许 `.` | Cargo crate name 只允许字母/数字/下划线/连字符 | 编译后 `cp` 重命名加版本号 |
| CDP 环境变量传递中断 | bash→powershell→Start-Process 传递链断裂 | 用 `.ps1` 脚本一次性设置 |
| vue-tsc 660 类型错误 | Electron→Tauri 迁移遗留的全局变量类型缺失 | 用 `npx vite build` 绕过，长期需补类型声明 |