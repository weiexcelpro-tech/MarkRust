---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '884c62a8-1727-4e55-8493-2caa7864bf57'
  PropagateID: '884c62a8-1727-4e55-8493-2caa7864bf57'
  ReservedCode1: '153e3e01-df7b-4795-b929-69315e323a8b'
  ReservedCode2: '153e3e01-df7b-4795-b929-69315e323a8b'
---

# MarkText 原版 vs Tauri 移植版 功能差异报告

> **报告版本**：v1.0
> **生成日期**：2026-07-18
> **作用范围**：菜单结构、快捷键、右键菜单、命令清单的完整功能对比
> **输出目标**：作为 E2E 回归测试用例设计的输入清单
> **平台基准**：Windows（macOS 专属菜单项不在本次对比范围内，但会标注）

---

## 第 1 章 菜单结构对比

### 1.1 对比基准

| 项 | 原版 | 移植版 |
|---|---|---|
| 菜单定义位置 | `marktext-develop/packages/desktop/src/main/menu/templates/*.ts`（12 个模板文件） | `marktext-tauri/src-tauri/src/commands/menu.rs`（586 行单文件） |
| 菜单组装方式 | `index.ts` 按 macOS/Win 分组拼装 | `menu.rs` 内 `build_menu()` 直接构建 |
| 顶级菜单数（Windows） | 8 个：File / Edit / Paragraph / Format / Window / Theme / View / Help | 7 个：File / Edit / Paragraph / Format / View / Window / Help（**无 Theme 菜单**） |

### 1.2 差异清单

#### DIFF-M-001 [缺失/CRITICAL] Theme 顶级菜单整体缺失
- **类别**：菜单结构
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`marktext-develop/packages/desktop/src/main/menu/templates/theme.ts`（整个文件）
- **移植版位置**：无对应
- **描述**：原版 Theme 菜单包含 1 个 `followSystemTheme` checkbox + 10 个 Light 主题 radio + 23 个 Dark 主题 radio（共 34 项）。移植版 `menu.rs` 完全没有 Theme 菜单，主题切换功能仅通过 Command Palette 中的 6 个主题命令暴露（见 DIFF-CMD-016）。用户无法通过菜单栏访问 28 个 CSS 主题。

#### DIFF-M-002 [缺失/HIGH] File.autoSave checkbox 菜单项缺失
- **类别**：File 菜单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`file.ts`（autoSave 项，`id: 'file.autoSave'`，`type: 'checkbox'`）
- **移植版位置**：`menu.rs` 中 File 菜单无 autoSave 项；命令清单 `descriptions.ts:30` 有 `file.toggle-auto-save` 命令定义但无菜单绑定
- **描述**：原版菜单栏可勾选/取消自动保存。移植版该命令存在但只能通过 Command Palette 触发，菜单入口丢失。

#### DIFF-M-003 [缺失/CRITICAL] File.import-file 菜单项缺失
- **类别**：File 菜单
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`file.ts`（`id: 'file.import-file'`）
- **移植版位置**：`descriptions.ts:19` 有 `'file.import-file'` 命令定义，但 `menu.rs` 无对应菜单项
- **描述**：原版菜单栏有"导入文件"入口（导入 .docx 等格式）。移植版命令注册了但菜单项未挂载，用户无法从菜单触发导入。

#### DIFF-M-004 [缺失/CRITICAL] File.export-file-html 菜单项缺失
- **类别**：File 菜单
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`file.ts`（export 子菜单中 `id: 'file.export-file-html'`）
- **移植版位置**：`menu.rs` 行约 17 项中 export 子菜单仅含 PDF；`descriptions.ts:24` 只有 `'file.export-file'` 总命令，无 `'file.export-file.html'` 子命令
- **描述**：原版 export 子菜单含 HTML + PDF 两个选项。移植版仅保留 PDF 导出，HTML 导出菜单入口丢失。

#### DIFF-M-005 [缺失/MEDIUM] File.OpenRecent 子菜单历史项缺失
- **类别**：File 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`file.ts`（OpenRecent 子菜单，动态填充最近打开文件列表）
- **移植版位置**：`menu.rs` 中 File 菜单有 Open Recent 顶层项，但动态历史项填充逻辑需验证（见 E2E 验证项 T-REG-014）
- **描述**：原版通过 `app.getRecentDocuments()` 动态填充最近文件列表。移植版菜单结构存在，但实际历史填充链路未知。

#### DIFF-M-006 [缺失/HIGH] Edit.copyAsHtml 菜单项缺失
- **类别**：Edit 菜单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`edit.ts`（`id: 'edit.copyAsHtml'`）
- **移植版位置**：`menu.rs` Edit 菜单无 copy-as-html 项；但 `descriptions.ts:61` 有 `'edit.copy-as-html'` 命令定义且 `keyboardShortcuts.ts` 中无快捷键绑定
- **描述**：原版菜单栏可"复制为 HTML"。移植版命令注册了，但菜单项丢失、快捷键也丢失，仅能通过 Command Palette 触发。

#### DIFF-M-007 [缺失/LOW] Edit.screenshot 菜单项缺失（macOS only）
- **类别**：Edit 菜单
- **差异类型**：缺失
- **严重度**：LOW
- **原版位置**：`edit.ts`（`id: 'edit.screenshot'`，仅 macOS 显示）
- **移植版位置**：`descriptions.ts:80` 有 `'edit.screenshot'` 命令定义；`menu.rs` 无对应菜单项
- **描述**：原版在 macOS 显示"截图"菜单项。移植版命令保留但菜单项丢失。本项 LOW 仅因平台条件限制。

#### DIFF-M-008 [缺失/HIGH] Edit.lineEnding 子菜单缺失
- **类别**：Edit 菜单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`edit.ts`（lineEnding 子菜单，含 CRLF / LF 两个 radio 项）
- **移植版位置**：`descriptions.ts:34` 有 `'file.line-ending'` 命令定义；`menu.rs` Edit 菜单无 lineEnding 子菜单
- **描述**：原版可在菜单栏切换行尾符（CRLF/LF）。移植版命令存在但菜单入口丢失。

#### DIFF-M-009 [变更/MEDIUM] Paragraph.heading1-6 菜单类型变更（checkbox → text）
- **类别**：Paragraph 菜单
- **差异类型**：role变更
- **严重度**：MEDIUM
- **原版位置**：`paragraph.ts`（heading1-6 均为 `type: 'checkbox'`，能反映当前光标所在段落的标题级别）
- **移植版位置**：`menu.rs` 中 heading1-6 为 `text_item`（仅文本项，无勾选状态反馈）
- **描述**：原版菜单可显示当前段落是几级标题（checkbox 打勾）。移植版降级为纯文本项，丢失状态反馈。影响 UX 一致性。

#### DIFF-M-010 [新增/LOW] Paragraph.reset-paragraph 菜单项新增
- **类别**：Paragraph 菜单
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无
- **移植版位置**：`menu.rs` Paragraph 菜单第 22 项；`descriptions.ts:110` `'paragraph.reset-paragraph'`
- **描述**：移植版新增"重置段落"菜单项，将当前块重置为普通段落。功能增强，非缺陷。

#### DIFF-M-011 [变更/LOW] Paragraph 子项 checkbox → text 类型批量变更
- **类别**：Paragraph 菜单
- **差异类型**：role变更
- **严重度**：LOW
- **原版位置**：`paragraph.ts`（table/codeFences/quoteBlock/mathBlock/htmlBlock/orderList/bulletList/taskList/looseListItem/paragraph/horizontalLine/frontMatter 全部 `type: 'checkbox'`）
- **移植版位置**：`menu.rs` 中对应项为 `text_item`
- **描述**：与 DIFF-M-009 同类问题，批量影响 12 个段落类型菜单项。原版能反映当前段落类型，移植版全部丢失状态反馈。

#### DIFF-M-012 [缺失/MEDIUM] View.commandPalette 菜单项未在标准位置
- **类别**：View 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`view.ts`（`id: 'view.commandPalette'`）
- **移植版位置**：`descriptions.ts:176` 有命令；`menu.rs` View 菜单无对应项；`menuBridge.ts` 中 command-palette 走特殊处理路径
- **描述**：原版 View 菜单首项为 Command Palette。移植版菜单栏无此入口，仅可通过 Ctrl+Shift+P 快捷键触发。

#### DIFF-M-013 [缺失/MEDIUM] View.toggleTableOfContents 菜单项缺失
- **类别**：View 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`view.ts`（`id: 'view.toggleTableOfContents'`）
- **移植版位置**：`descriptions.ts:165` `'view.toggle-toc'`；`menuBridge.ts` 的 `LAYOUT_MENU_MAP` 中 `tocMenuItem→rightColumn`；`menu.rs` View 菜单无对应项
- **描述**：原版菜单栏可切换目录侧栏。移植版仅通过快捷键 Ctrl+K 触发，菜单入口丢失。

#### DIFF-M-014 [缺失/LOW] View.reloadImages 菜单项缺失
- **类别**：View 菜单
- **差异类型**：缺失
- **严重度**：LOW
- **原版位置**：`view.ts`（`id: 'view.reloadImages'`）
- **移植版位置**：`descriptions.ts:186` `'view.reload-images'`；`keyboardShortcuts.ts:88` F5 快捷键绑定；`menu.rs` View 菜单无对应项
- **描述**：原版菜单栏可重新加载图片。移植版仅 F5 快捷键可触发。

#### DIFF-M-015 [缺失/MEDIUM] View.debug 子菜单缺失
- **类别**：View 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`view.ts`（debug 分组含 `showDeveloperTools`、`reloadWindow`，仅 dev 模式显示）
- **移植版位置**：`descriptions.ts:181-183` 有 `'view.dev-reload'`、`'view.toggle-dev-tools'` 命令定义；`menu.rs` View 菜单无对应项
- **描述**：原版 dev 模式下可从菜单打开开发者工具和重载窗口。移植版命令注册但菜单入口丢失，需通过 Webview2 快捷键替代。

#### DIFF-M-016 [缺失/HIGH] Window.zoomIn / zoomOut 菜单项缺失
- **类别**：Window 菜单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`window.ts`（`id: 'window.zoomIn'`、`id: 'window.zoomOut'`）
- **移植版位置**：`descriptions.ts:153-154` 有命令定义；`menu.rs` Window 菜单仅 3 项（minimize / alwaysOnTop / fullScreen）；`keyboardShortcuts.ts` 也无 zoomIn/zoomOut 快捷键
- **描述**：原版菜单栏可放大/缩小窗口内容。移植版菜单和快捷键双丢失，仅能通过 `file.zoom` 命令（12 级缩放）从 Command Palette 触发，UX 路径不一致。

#### DIFF-M-017 [缺失/MEDIUM] Help.followUs / support / askQuestion / license 菜单项缺失
- **类别**：Help 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`help.ts`（followUs / support / askQuestion / reportBug / viewSource / license 等项）
- **移植版位置**：`menu.rs` Help 菜单仅 5 项；`menuBridge.ts` 的 `HELP_MENU_MAP` 仅含 4 个 URL 映射
- **描述**：原版 Help 菜单有 6+ 社区/支持类入口。移植版精简到 5 项，丢失 followUs / support / askQuestion / license 等链接入口。

#### DIFF-M-018 [缺失/MEDIUM] Help.checkUpdates 菜单项缺失（非 macOS）
- **类别**：Help 菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`help.ts`（`id: 'file.check-update'`，条件性显示：`if (updatable)` 才显示）
- **移植版位置**：`descriptions.ts:41` 有 `'file.check-update'` 命令定义；`menu.rs` Help 菜单无对应项
- **描述**：原版若应用可更新则显示"检查更新"。移植版命令保留但菜单入口丢失，自动更新入口不可见。

#### DIFF-M-019 [缺失/LOW] Edit.copyAsRich 菜单项标签/快捷键一致，验证保留
- **类别**：Edit 菜单
- **差异类型**：缺失（仅核对项）
- **严重度**：LOW
- **原版位置**：`edit.ts`（`id: 'edit.copyAsRich'`）
- **移植版位置**：`menu.rs` Edit 菜单有 copy-as-rich 项；快捷键 `Ctrl+Shift+C`（`keyboardShortcuts.ts:41`）
- **描述**：核对项，原版与移植版一致，无差异。仅记录用于回归测试覆盖。

#### DIFF-M-020 [缺失/LOW] Window.alwaysOnTop checkbox 项核对
- **类别**：Window 菜单
- **差异类型**：一致性核对
- **严重度**：LOW
- **原版位置**：`window.ts`（`id: 'window.toggleAlwaysOnTop'`，`type: 'checkbox'`）
- **移植版位置**：`menu.rs` Window 菜单含 alwaysOnTop 项；`capabilities/default.json` 含 `set-always-on-top` / `is-always-on-top` 权限
- **描述**：核对项，菜单项存在，权限已补齐（已知修复项）。仅记录用于回归测试覆盖。

---

## 第 2 章 快捷键对比

### 2.1 对比基准

| 项 | 原版 | 移植版 |
|---|---|---|
| 快捷键定义位置 | `marktext-develop/packages/desktop/src/main/keyboard/keybindingsWindows.ts`（54 个映射） | `marktext-tauri/src/renderer/src/keyboardShortcuts.ts`（57 个映射） |
| 触发机制 | Electron 主进程 `globalShortcut` + 菜单 accelerator | WebView2 keydown capture phase 拦截 → `handleMenuClick(id)` |
| 已知架构差异 | 菜单 .accelerator() 在 Tauri 2 仅显示标签不拦截事件，移植版需独立 JS 桥接（见 keyboardShortcuts.ts:1-9 注释） |

### 2.2 差异清单

#### DIFF-K-001 [缺失/CRITICAL] heading1-6 快捷键缺失
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`keybindingsWindows.ts`（`paragraph.heading1` ~ `paragraph.heading6` 共 6 个，但值为空字符串——表示无默认快捷键，但用户可自定义）
- **移植版位置**：`keyboardShortcuts.ts` 的 SHORTCUT_MAP 无 heading1-6 映射
- **描述**：原版虽默认无快捷键但保留可配置入口。移植版完全移除。影响：用户无法通过 setting.json 自定义 heading 快捷键。注：此差异严重度下調为 MEDIUM 也可接受，因原版默认也未绑定。

#### DIFF-K-002 [缺失/HIGH] superscript / subscript 快捷键缺失
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`keybindingsWindows.ts`（`format.superscript`、`format.subscript`，值为空字符串）
- **移植版位置**：`keyboardShortcuts.ts` 无对应映射
- **描述**：与 DIFF-K-001 同类问题。移植版格式化菜单中 superscript / subscript 仍存在（菜单层未丢失），但快捷键入口丢失。

#### DIFF-K-003 [缺失/HIGH] window.zoomIn / zoomOut 快捷键缺失
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`keybindingsWindows.ts`（`window.zoomIn` / `window.zoomOut`，值为空字符串）
- **移植版位置**：`keyboardShortcuts.ts` 无对应映射；菜单层也丢失（见 DIFF-M-016）
- **描述**：窗口缩放功能菜单+快捷键双丢失。仅能通过 `file.zoom` 命令从 Command Palette 触发，UX 严重退化。

#### DIFF-K-004 [缺失/MEDIUM] file.quick-open 快捷键缺失
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`keybindingsWindows.ts`（`file.quick-open` → `Ctrl+P`）
- **移植版位置**：`keyboardShortcuts.ts:32` 仅 `'Ctrl+P': 'file.print'`；无 quick-open 映射
- **描述**：原版 quick-open 与 print 共享 Ctrl+P（原版有优先级逻辑）。移植版 Ctrl+P 仅绑定 print，quick-open 功能丢失。

#### DIFF-K-005 [缺失/LOW] edit.screenshot 快捷键缺失（macOS only）
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts`（`edit.screenshot`，值为空字符串，且 Windows 不显示）
- **移植版位置**：`keyboardShortcuts.ts` 无对应映射
- **描述**：与 DIFF-M-007 对应。LOW 因平台限制。

#### DIFF-K-006 [缺失/LOW] dev-tools / dev-reload 快捷键缺失
- **类别**：快捷键
- **差异类型**：缺失
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts`（`view.toggle-dev-tools`、`view.dev-reload`）
- **移植版位置**：`keyboardShortcuts.ts` 无对应映射；`descriptions.ts:181-183` 命令存在
- **描述**：dev 工具切换和窗口重载的快捷键入口丢失，仅能通过 WebView2 默认 F12 / Ctrl+R 替代。

#### DIFF-K-007 [变更/MEDIUM] file.print 快捷键 Ctrl+P 与原版 quick-open 冲突
- **类别**：快捷键
- **差异类型**：快捷键变更
- **严重度**：MEDIUM
- **原版位置**：`file.print` 默认 `Ctrl+P`；`file.quick-open` 也默认 `Ctrl+P`（原版有路由优先级）
- **移植版位置**：`keyboardShortcuts.ts:32` `'Ctrl+P': 'file.print'` 独占
- **描述**：移植版 Ctrl+P 仅触发打印，quick-open 路径丢失（与 DIFF-K-004 关联）。功能行为变更。

#### DIFF-K-008 [新增/LOW] tabs.cycleForward / cycleBackward 快捷键新增
- **类别**：快捷键
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts` 的 Tabs 分组无 cycleForward/cycleBackward（仅有 switchToLeft/Right/1-10）
- **移植版位置**：`keyboardShortcuts.ts:95-96`（`Ctrl+Tab` → cycleForward、`Ctrl+Shift+Tab` → cycleBackward）
- **描述**：移植版新增"循环切换标签页"快捷键。功能增强。

#### DIFF-K-009 [新增/LOW] paragraph.math-formula 快捷键 Ctrl+Alt+N 新增
- **类别**：快捷键
- **差异类型**：新增/ID变更
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts` 中 `paragraph.math-block` → `Ctrl+Alt+N`
- **移植版位置**：`keyboardShortcuts.ts:58` `'Ctrl+Alt+N': 'paragraph.math-formula'`
- **描述**：原版叫 `math-block`，移植版改为 `math-formula`。命令 ID 变更但快捷键保留。需在测试中映射新 ID。

#### DIFF-K-010 [变更/MEDIUM] Format 项 ID 改用 menuBridge ID 命名
- **类别**：快捷键
- **差异类型**：ID变更
- **严重度**：MEDIUM
- **原版位置**：`keybindingsWindows.ts`（`format.strong` → `Ctrl+B` 等，使用 `format.*` 命名空间）
- **移植版位置**：`keyboardShortcuts.ts:69-78`（`'Ctrl+B': 'strongMenuItem'` 等，使用 menuBridge `FORMAT_MENU_MAP` 的 ID）
- **描述**：移植版 Format 快捷键的 command ID 从 `format.strong` 改为 `strongMenuItem`。这是设计差异（统一走 menuBridge 分发），非缺陷，但 E2E 测试需使用新 ID。

#### DIFF-K-011 [新增/LOW] ALWAYS_FIRE 白名单机制新增
- **类别**：快捷键
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无显式白名单机制
- **移植版位置**：`keyboardShortcuts.ts:167-182`（30 个命令列入 ALWAYS_FIRE）
- **描述**：移植版新增"在文本输入框中仍触发的快捷键白名单"机制，避免在 find/replace 栏中输入字符时被编辑器快捷键拦截（如 Ctrl+B 在输入框中应插入字符而非触发加粗）。架构增强。

#### DIFF-K-012 [变更/LOW] paragraph.front-matter 快捷键变更
- **类别**：快捷键
- **差异类型**：快捷键变更
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts`（`paragraph.frontMatter` → `Ctrl+Alt+F`）
- **移植版位置**：`keyboardShortcuts.ts:66` `'Ctrl+Alt+Y': 'paragraph.front-matter'`
- **描述**：原版 `Ctrl+Alt+F`，移植版改为 `Ctrl+Alt+Y`。可能因 `Ctrl+Alt+F` 与系统全屏冲突。需在测试中验证。

#### DIFF-K-013 [一致性/LOW] 核心快捷键 Ctrl+S / Ctrl+O / Ctrl+Z 一致
- **类别**：快捷键
- **差异类型**：一致性核对
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts`（file.save=Ctrl+S, file.open-file=Ctrl+O, edit.undo=Ctrl+Z 等）
- **移植版位置**：`keyboardShortcuts.ts:29,27,39` 一致
- **描述**：核对项，核心 File/Edit 快捷键完全保留。仅记录用于回归覆盖。

---

## 第 3 章 右键菜单对比

### 3.1 对比基准

| 项 | 原版 | 移植版 |
|---|---|---|
| 右键菜单定义位置 | `marktext-develop/packages/desktop/src/main/contextMenu/editor/`（3 个文件） | `marktext-tauri/src/renderer/src/components/editorWithTabs/editor.vue:1592-1616` |
| 弹出机制 | Electron 主进程 `Menu.buildFromTemplate()` 原生菜单 | `popupMenu.ts` 通过 IPC 调用 Tauri `Menu.popup()` |
| i18n 处理 | `t()` 函数获取标签 | **硬编码英文字符串** |

### 3.2 差异清单

#### DIFF-C-001 [缺陷/CRITICAL] CodeMirror stopPropagation 截断 DOM contextmenu 事件
- **类别**：右键菜单
- **差异类型**：缺陷
- **严重度**：CRITICAL
- **移植版位置**：`marktext-tauri/src/renderer/src/components/editorWithTabs/sourceCode.vue:377-380`
- **原版位置**：无对应缺陷（原版 CodeMirror 配置不同）
- **描述**：移植版在源码模式下，CodeMirror 的事件处理器调用 `e.stopPropagation()` 截断了 `contextmenu` 事件，导致 `handleEditorContextMenu` 永远收不到事件，右键菜单在源码模式完全无响应。这是用户预先告知的三个根因之一（**CRITICAL 根因**）。

#### DIFF-C-002 [缺失/CRITICAL] contextMenu/editor 主进程目录整体未移植
- **类别**：右键菜单
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`marktext-develop/packages/desktop/src/main/contextMenu/editor/` 整个目录（`index.ts` / `menuItems.ts` / `spellcheck.ts` 三文件）
- **移植版位置**：`editor.vue:1592-1616` 用内联 template 简化实现，仅 9 项
- **描述**：原版完整的右键菜单模板组装逻辑（含动态启用/禁用、spellcheck 子菜单、addToDictionary 等）整体未迁移到 Tauri 主进程。移植版仅在渲染层用极简 template 替代。这是用户预先告知的三个根因之二（**CRITICAL 根因**）。

#### DIFF-C-003 [缺失/HIGH] store/editor.ts 6 个 IPC 监听器成孤儿
- **类别**：右键菜单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`marktext-develop/packages/desktop/src/renderer/src/store/editor.ts`（监听器与主进程右键菜单配对）
- **移植版位置**：`marktext-tauri/src/renderer/src/store/editor.ts:1738-1756`（监听器保留但发送端已删除）
- **描述**：移植版保留以下 6 个 IPC 监听器但永不触发（因主进程右键菜单未移植）：
  - `mt::cm-copy-as-rich` (line 1738)
  - `mt::cm-copy-as-html` (line 1741)
  - `mt::cm-paste-as-plain-text` (line 1744)
  - `mt::cm-insert-paragraph` (line 1747)
  - `mt::spelling-replace-misspelling` (line 1752)
  - `mt::spelling-show-switch-language` (line 1755)

  这是用户预先告知的三个根因之三（**孤儿监听器**）。

#### DIFF-C-004 [缺失/CRITICAL] spellcheck 拼写检查子菜单完全缺失
- **类别**：右键菜单
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`marktext-develop/packages/desktop/src/main/contextMenu/editor/spellcheck.ts`（含 changeLanguage / addToDictionary / wordSuggestions 动态生成 / editDictionary）
- **移植版位置**：无；`descriptions.ts:218` 有 `'spellchecker.switch-language'` 命令定义但无调用链；`capabilities/default.json` 无 spellcheck 权限
- **描述**：原版右键菜单在拼写错误单词上有"单词建议 / 添加到词典 / 切换语言"子菜单。移植版完全无此功能，且无对应 Tauri 权限申请。这是导致 DIFF-C-003 中 2 个 spelling 监听器成孤儿的根因。

#### DIFF-C-005 [缺陷/HIGH] 右键菜单标签硬编码英文未走 i18n
- **类别**：右键菜单
- **差异类型**：label变更/缺陷
- **严重度**：HIGH
- **原版位置**：`menuItems.ts`（所有标签通过 `t()` 函数获取，支持多语言）
- **移植版位置**：`editor.vue:1592-1616`（标签如 `"Insert Paragraph Before"` 硬编码英文字符串）
- **描述**：移植版右键菜单标签未通过 i18n 函数，中文用户看到英文菜单项。国际化能力退化。

#### DIFF-C-006 [缺陷/MEDIUM] 使用已废弃的 document.execCommand API
- **类别**：右键菜单
- **差异类型**：缺陷
- **严重度**：MEDIUM
- **原版位置**：`menuItems.ts`（cut/copy/paste 使用 Electron `role`，由原生菜单处理）
- **移植版位置**：`editor.vue` 中 cut/copy/paste 调用 `document.execCommand('cut'/'copy'/'paste')`（已废弃 API，浏览器即将移除）
- **描述**：移植版使用已废弃的 `document.execCommand`，未来 WebView2 升级后可能失效。建议改用 `clipboard-manager` Tauri 权限（`capabilities/default.json` 中已申请 read-text/write-text）。

#### DIFF-C-007 [缺失/MEDIUM] insertParagraph Before/After 动态启用逻辑缺失
- **类别**：右键菜单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`index.ts`（根据 `canCopy` / 光标位置动态启用/禁用 insertBefore/insertAfter）
- **移植版位置**：`editor.vue:1592-1616` 菜单项恒为启用状态
- **描述**：原版根据上下文动态控制菜单项 enabled 状态。移植版简化为恒启用，可能在不可用场景误触发。

#### DIFF-C-008 [一致性/LOW] 核心 9 项菜单结构保留
- **类别**：右键菜单
- **差异类型**：一致性核对
- **严重度**：LOW
- **原版位置**：`menuItems.ts`（insertBefore/insertAfter/cut/copy/paste/copyAsRich/copyAsHtml/pasteAsPlainText = 8 项 + 1 SEPARATOR）
- **移植版位置**：`editor.vue:1592-1616`（9 项含 separator，结构基本对齐）
- **描述**：核对项，核心菜单项结构保留。但 copyAsHtml 在移植版右键菜单存在（line ~1611），而 Edit 菜单栏丢失（DIFF-M-006），存在不一致。仅记录用于回归覆盖。

---

## 第 4 章 命令清单对比

### 4.1 对比基准

| 项 | 原版 | 移植版 |
|---|---|---|
| 命令注册位置 | 散落于各菜单模板 + `keybindingsWindows.ts` | `marktext-tauri/src/renderer/src/commands/index.ts`（754 行，集中注册） + `descriptions.ts`（229 行，73 个命令描述映射） |
| 总命令数 | 约 65（菜单项 ID 去重） | 约 73（含子命令） |

### 4.2 差异清单

#### DIFF-CMD-001 [缺失/CRITICAL] edit.copy-as-html 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：CRITICAL
- **原版位置**：`edit.ts`（菜单项 + 命令均存在）
- **移植版位置**：`descriptions.ts:61` `'edit.copy-as-html'` 命令注册；`keyboardShortcuts.ts` 无快捷键；`menu.rs` Edit 菜单无对应项；右键菜单中存在（DIFF-C-008）
- **描述**：命令注册了，但菜单入口和快捷键双丢失，仅能通过右键菜单或 Command Palette 触发。功能可达性严重退化。

#### DIFF-CMD-002 [缺失/CRITICAL] edit.screenshot 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：CRITICAL（macOS） / LOW（Windows）
- **原版位置**：`edit.ts`（macOS 菜单项 + 命令）
- **移植版位置**：`descriptions.ts:80` `'edit.screenshot'` 命令注册；菜单层丢失
- **描述**：与 DIFF-M-007 / DIFF-K-005 关联。

#### DIFF-CMD-003 [缺失/HIGH] view.command-palette 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`view.ts`（菜单项首项）
- **移植版位置**：`descriptions.ts:176` `'view.command-palette'` 命令注册；`menuBridge.ts` 走特殊处理路径；`keyboardShortcuts.ts:81` `Ctrl+Shift+P` 快捷键绑定；`menu.rs` View 菜单无对应项
- **描述**：命令存在且快捷键保留，但菜单入口丢失。功能可用但发现性降低。

#### DIFF-CMD-004 [缺失/HIGH] view.reload-images 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`view.ts`（菜单项）
- **移植版位置**：`descriptions.ts:186` `'view.reload-images'` 命令注册；`keyboardShortcuts.ts:88` `F5` 快捷键绑定；`menu.rs` View 菜单无对应项
- **描述**：与 DIFF-M-014 关联。

#### DIFF-CMD-005 [缺失/HIGH] view.toggle-toc 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`view.ts`（菜单项）
- **移植版位置**：`descriptions.ts:165` `'view.toggle-toc'` 命令注册；`menuBridge.ts` 的 `LAYOUT_MENU_MAP` 中 `tocMenuItem→rightColumn`；`keyboardShortcuts.ts:86` `Ctrl+K` 快捷键绑定；`menu.rs` View 菜单无对应项
- **描述**：与 DIFF-M-013 关联。

#### DIFF-CMD-006 [缺失/HIGH] window.zoomIn / zoomOut 命令在菜单+快捷键双丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`window.ts`（菜单项 + 命令）
- **移植版位置**：`descriptions.ts:153-154` 命令注册；`menu.rs` 无菜单项；`keyboardShortcuts.ts` 无快捷键
- **描述**：与 DIFF-M-016 / DIFF-K-003 关联。命令仅能从 Command Palette 触发。

#### DIFF-CMD-007 [缺失/HIGH] file.export-file-html 子命令丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`file.ts`（export 子菜单含 HTML + PDF 两子命令）
- **移植版位置**：`descriptions.ts:24-25` 仅有 `'file.export-file'` 总命令 + `'file.export-file-pdf'` 子命令，无 `'file.export-file-html'` 子命令
- **描述**：与 DIFF-M-004 关联。命令注册层就丢失了 HTML 导出子命令。

#### DIFF-CMD-008 [缺失/HIGH] file.import-file 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：HIGH
- **原版位置**：`file.ts`（菜单项 + 命令）
- **移植版位置**：`descriptions.ts:19` `'file.import-file'` 命令注册；`menu.rs` File 菜单无对应项
- **描述**：与 DIFF-M-003 关联。

#### DIFF-CMD-009 [缺失/MEDIUM] file.toggle-auto-save 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`file.ts`（autoSave checkbox 菜单项 + 命令）
- **移植版位置**：`descriptions.ts:30` `'file.toggle-auto-save'` 命令注册；`menu.rs` File 菜单无对应项
- **描述**：与 DIFF-M-002 关联。

#### DIFF-CMD-010 [缺失/MEDIUM] file.line-ending 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`edit.ts`（lineEnding 子菜单 + CRLF/LF radio 子命令）
- **移植版位置**：`descriptions.ts:34` `'file.line-ending'` 命令注册；`menu.rs` Edit 菜单无对应项；无 CRLF/LF 子命令
- **描述**：与 DIFF-M-008 关联。原版的两个 radio 子命令丢失。

#### DIFF-CMD-011 [缺失/MEDIUM] file.check-update 命令在菜单层丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`help.ts`（条件性菜单项 + 命令）
- **移植版位置**：`descriptions.ts:41` `'file.check-update'` 命令注册；`menu.rs` Help 菜单无对应项
- **描述**：与 DIFF-M-018 关联。

#### DIFF-CMD-012 [缺失/MEDIUM] view.dev-reload / view.toggle-dev-tools 命令在菜单+快捷键双丢失
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：MEDIUM
- **原版位置**：`view.ts`（debug 子菜单 + 命令）
- **移植版位置**：`descriptions.ts:181-183` 命令注册；`menu.rs` View 菜单无对应项；`keyboardShortcuts.ts` 无快捷键
- **描述**：与 DIFF-M-015 / DIFF-K-006 关联。

#### DIFF-CMD-013 [缺失/LOW] Theme 选择命令批量丢失（28 个主题）
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：LOW（因有 Command Palette 部分替代）
- **原版位置**：`theme.ts`（33 个主题 radio 命令）
- **移植版位置**：`descriptions.ts` 无主题批量命令；`menuBridge.ts` 中 theme 走特殊处理，仅 6 个主题在 Command Palette 中暴露
- **描述**：与 DIFF-M-001 关联。命令层仅保留 6 个主题，丢失 28 个 CSS 主题的命令入口。

#### DIFF-CMD-014 [缺失/LOW] edit.cut / copy / paste / select-all 命令由 PredefinedMenuItem 处理
- **类别**：命令清单
- **差异类型**：缺失/架构变更
- **严重度**：LOW
- **原版位置**：`edit.ts`（cut/copy/paste/selectAll 使用 Electron `role`）
- **移植版位置**：`menu.rs` Edit 菜单使用 `PredefinedMenuItem`；`descriptions.ts:57-65` 仍注册命令 ID 但实际由系统菜单项处理
- **描述**：架构变更，cut/copy/paste 改由 Tauri PredefinedMenuItem 系统菜单处理，custom handler 不再触发。功能等价但 E2E 测试需用系统快捷键而非 menu click。

#### DIFF-CMD-015 [新增/LOW] paragraph.reset-paragraph 命令新增
- **类别**：命令清单
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无
- **移植版位置**：`descriptions.ts:110` `'paragraph.reset-paragraph'`；`menu.rs` Paragraph 菜单第 22 项
- **描述**：与 DIFF-M-010 关联。功能增强。

#### DIFF-CMD-016 [新增/LOW] file.zoom 命令新增（12 级缩放）
- **类别**：命令清单
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无（原版用 window.zoomIn/zoomOut 增量缩放）
- **移植版位置**：`descriptions.ts:40` `'file.zoom'`；无菜单项无快捷键，仅 Command Palette 触发
- **描述**：移植版用 12 级离散缩放替代原版的增量缩放。设计差异。

#### DIFF-CMD-017 [新增/LOW] view.text-direction 命令新增（LTR/RTL）
- **类别**：命令清单
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无
- **移植版位置**：`descriptions.ts:178` `'view.text-direction'`
- **描述**：移植版新增文字方向切换（左到右/右到左）。功能增强，支持阿拉伯语等 RTL 语言。

#### DIFF-CMD-018 [新增/LOW] docs.user-guide / docs.markdown-syntax 命令新增
- **类别**：命令清单
- **差异类型**：新增
- **严重度**：LOW
- **原版位置**：无（原版 help 菜单的 markdownReference 走不同命令 ID）
- **移植版位置**：`descriptions.ts:212-213` `'docs.user-guide'` / `'docs.markdown-syntax'`
- **描述**：移植版新增文档类命令命名空间。功能等价于原版的 markdownReference，但 ID 变更。

#### DIFF-CMD-019 [新增/LOW] tabs.switchToLeft/Right/1-10 命令保留
- **类别**：命令清单
- **差异类型**：一致性核对
- **严重度**：LOW
- **原版位置**：`keybindingsWindows.ts` Tabs 分组
- **移植版位置**：`descriptions.ts:192-207` 全部保留
- **描述**：核对项，13 个标签切换命令全部保留。仅记录用于回归覆盖。

#### DIFF-CMD-020 [缺失/LOW] spellchecker.switch-language 命令成孤儿
- **类别**：命令清单
- **差异类型**：缺失
- **严重度**：LOW
- **原版位置**：`spellcheck.ts`（通过右键菜单触发）
- **移植版位置**：`descriptions.ts:218` `'spellchecker.switch-language'` 命令注册；但右键菜单丢失（DIFF-C-004），无任何调用入口
- **描述**：与 DIFF-C-003 / DIFF-C-004 关联。命令注册了但无 UI 入口。

---

## 第 5 章 E2E 回归测试优先级清单

> **排序规则**：按 severity 降序（CRITICAL → HIGH → MEDIUM → LOW），同 severity 内按差异影响范围排序。
> **用例 ID 格式**：T-REG-xxx（REG = Regression）
> **验证方法**：每个用例给出具体可执行的验证步骤，使用 L3 命令巡检 + CDP 自动化。

### CRITICAL 级（必须阻塞发布）

#### T-REG-001 验证 Theme 顶级菜单整体缺失影响
- **关联差异**：DIFF-M-001 / DIFF-CMD-013
- **验证步骤**：
  1. 启动应用，依次检查菜单栏顶级菜单数量（应=7，无 Theme）
  2. 通过 Command Palette 查询可用的主题命令（应=6 个）
  3. 切换至 Light 主题，验证 CSS 应用
  4. 切换至 Dark 主题，验证 CSS 应用
- **预期**：顶级无 Theme 菜单（已知设计差异），Command Palette 仅 6 主题可用，28 个 CSS 主题丢失
- **优先级**：P0

#### T-REG-002 验证源码模式下右键菜单无响应
- **关联差异**：DIFF-C-001
- **验证步骤**：
  1. 启动应用，新建文档，输入若干文字
  2. 切换至源码模式（Ctrl+E）
  3. 在编辑器内右键
- **预期**：右键菜单**不弹出**（CRITICAL 缺陷，需修复后该用例失败才算通过）
- **优先级**：P0
- **修复验证**：修复 sourceCode.vue:377-380 的 stopPropagation 后，右键菜单应正常弹出

#### T-REG-003 验证 contextMenu/editor 主进程目录未移植的连锁影响
- **关联差异**：DIFF-C-002 / DIFF-C-003
- **验证步骤**：
  1. 在编辑器右键，验证 9 项菜单结构（含 separator）
  2. 通过 CDP 检查 store/editor.ts 中 6 个孤儿 IPC 监听器是否触发
  3. 触发右键菜单的 copy-as-rich / copy-as-html / paste-as-plain / insert-paragraph，验证对应 IPC 是否发出
- **预期**：菜单弹出正常，但 6 个孤儿监听器永不触发（CRITICAL 缺陷）
- **优先级**：P0

#### T-REG-004 验证 spellcheck 拼写检查子菜单完全缺失
- **关联差异**：DIFF-C-004 / DIFF-CMD-020
- **验证步骤**：
  1. 输入拼写错误单词（如 "teh"）
  2. 在错误单词上右键
- **预期**：无"单词建议"子菜单，无"添加到词典"项，无"切换语言"项（CRITICAL 缺陷）
- **优先级**：P0

#### T-REG-005 验证 File.import-file 菜单入口缺失
- **关联差异**：DIFF-M-003 / DIFF-CMD-008
- **验证步骤**：
  1. 展开 File 菜单
  2. 检查是否有"Import"项
- **预期**：无 Import 菜单项（CRITICAL 缺陷）
- **优先级**：P0

#### T-REG-006 验证 File.export-file-html 子菜单缺失
- **关联差异**：DIFF-M-004 / DIFF-CMD-007
- **验证步骤**：
  1. 展开 File 菜单 → Export 子菜单
  2. 检查子菜单项
- **预期**：仅有 PDF 一项，无 HTML 项（CRITICAL 缺陷）
- **优先级**：P0

### HIGH 级（重要缺陷，建议本版修复）

#### T-REG-007 验证 edit.copy-as-html 菜单入口缺失
- **关联差异**：DIFF-M-006 / DIFF-CMD-001
- **验证步骤**：
  1. 展开 Edit 菜单
  2. 检查是否有"Copy As HTML"项
  3. 在编辑器选中文本右键，检查是否有"Copy As HTML"项
  4. 通过 Command Palette 查询 `edit.copy-as-html`
- **预期**：Edit 菜单无此项，右键菜单有此项，Command Palette 有此命令（不一致）
- **优先级**：P1

#### T-REG-008 验证 Window.zoomIn / zoomOut 菜单+快捷键双丢失
- **关联差异**：DIFF-M-016 / DIFF-K-003 / DIFF-CMD-006
- **验证步骤**：
  1. 展开 Window 菜单，检查项数（应=3，无 zoomIn/zoomOut）
  2. 按 Ctrl+= / Ctrl+- 验证无响应
  3. 通过 Command Palette 触发 `file.zoom`，验证 12 级缩放可用
- **预期**：菜单无 zoom 项，快捷键无响应，仅 Command Palette 可缩放（HIGH 缺陷）
- **优先级**：P1

#### T-REG-009 验证 Edit.lineEnding 子菜单缺失
- **关联差异**：DIFF-M-008 / DIFF-CMD-010
- **验证步骤**：
  1. 展开 Edit 菜单
  2. 检查是否有 Line Ending 子菜单（CRLF / LF）
- **预期**：无 Line Ending 子菜单（HIGH 缺陷）
- **优先级**：P1

#### T-REG-010 验证右键菜单标签未走 i18n
- **关联差异**：DIFF-C-005
- **验证步骤**：
  1. 切换应用语言为中文（如设置中可选）
  2. 在编辑器右键
  3. 检查菜单项语言
- **预期**：右键菜单显示英文（HIGH 缺陷，i18n 退化）
- **优先级**：P1

#### T-REG-011 验证 File.autoSave checkbox 菜单缺失
- **关联差异**：DIFF-M-002 / DIFF-CMD-009
- **验证步骤**：
  1. 展开 File 菜单，检查是否有 autoSave checkbox
  2. 通过 Command Palette 查询 `file.toggle-auto-save`
- **预期**：菜单无 checkbox 项，Command Palette 有命令（HIGH 缺陷）
- **优先级**：P1

### MEDIUM 级（功能降级，可纳入下版修复）

#### T-REG-012 验证 View.commandPalette 菜单入口缺失
- **关联差异**：DIFF-M-012 / DIFF-CMD-003
- **验证步骤**：
  1. 展开 View 菜单首项
  2. 检查是否有 Command Palette 项
  3. 按 Ctrl+Shift+P 验证 Command Palette 弹出
- **预期**：菜单无此项，快捷键可用（MEDIUM 缺陷，发现性降低）
- **优先级**：P2

#### T-REG-013 验证 View.toggleTableOfContents 菜单入口缺失
- **关联差异**：DIFF-M-013 / DIFF-CMD-005
- **验证步骤**：
  1. 展开 View 菜单
  2. 检查是否有 TOC 项
  3. 按 Ctrl+K 验证 TOC 切换
- **预期**：菜单无此项，快捷键可用（MEDIUM 缺陷）
- **优先级**：P2

#### T-REG-014 验证 File.OpenRecent 历史项动态填充
- **关联差异**：DIFF-M-005
- **验证步骤**：
  1. 打开若干文件
  2. 关闭后再次展开 File 菜单 → Open Recent
  3. 检查最近文件列表是否填充
- **预期**：列表填充正常（核对项，若不填充则升级为 MEDIUM 缺陷）
- **优先级**：P2

#### T-REG-015 验证 Paragraph.heading1-6 checkbox 状态反馈丢失
- **关联差异**：DIFF-M-009 / DIFF-M-011
- **验证步骤**：
  1. 在编辑器输入"# 标题一"
  2. 光标置于该行
  3. 展开 Paragraph 菜单，检查 heading1 项
- **预期**：原版 heading1 应打勾，移植版为纯文本无打勾（MEDIUM 缺陷，UX 退化）
- **优先级**：P2

#### T-REG-016 验证 View.debug 子菜单缺失
- **关联差异**：DIFF-M-015 / DIFF-CMD-012
- **验证步骤**：
  1. 启动 dev 模式应用
  2. 展开 View 菜单
  3. 检查是否有 Developer Tools / Reload Window 项
- **预期**：无 debug 子菜单（MEDIUM 缺陷，仅影响开发）
- **优先级**：P2

#### T-REG-017 验证 Help 菜单社区类入口缺失
- **关联差异**：DIFF-M-017
- **验证步骤**：
  1. 展开 Help 菜单
  2. 检查项数（应=5）
  3. 检查是否有 followUs / support / askQuestion / license
- **预期**：仅 5 项，4 个社区入口丢失（MEDIUM 缺陷）
- **优先级**：P2

#### T-REG-018 验证 Help.checkUpdates 菜单入口缺失
- **关联差异**：DIFF-M-018 / DIFF-CMD-011
- **验证步骤**：
  1. 展开 Help 菜单
  2. 检查是否有"Check for Updates"项
  3. 通过 Command Palette 查询 `file.check-update`
- **预期**：菜单无此项，命令存在（MEDIUM 缺陷）
- **优先级**：P2

#### T-REG-019 验证 file.quick-open 快捷键 Ctrl+P 路径变更
- **关联差异**：DIFF-K-004 / DIFF-K-007
- **验证步骤**：
  1. 按 Ctrl+P
- **预期**：触发 file.print（移植版行为），不触发 quick-open（MEDIUM 缺陷，行为变更）
- **优先级**：P2

#### T-REG-020 验证 document.execCommand 废弃 API 使用
- **关联差异**：DIFF-C-006
- **验证步骤**：
  1. 在编辑器右键 → Cut / Copy / Paste
  2. 通过 CDP 检查 console 是否有 deprecation warning
- **预期**：功能正常但有 deprecation warning（MEDIUM 缺陷，未来风险）
- **优先级**：P2

#### T-REG-021 验证 insertParagraph 动态启用逻辑缺失
- **关联差异**：DIFF-C-007
- **验证步骤**：
  1. 在空文档首行右键
  2. 检查 Insert Paragraph Before 是否恒启用
- **预期**：恒启用（MEDIUM 缺陷，可能误触发）
- **优先级**：P2

### LOW 级（核对项 + 增强项）

#### T-REG-022 验证核心快捷键 Ctrl+S/O/Z 保留
- **关联差异**：DIFF-K-013
- **验证步骤**：依次按 Ctrl+S（保存）/ Ctrl+O（打开）/ Ctrl+Z（撤销），验证功能正常
- **预期**：全部正常（核对项）
- **优先级**：P3

#### T-REG-023 验证 tabs.switchTo1-10 命令保留
- **关联差异**：DIFF-CMD-019
- **验证步骤**：打开 10+ 标签，按 Ctrl+1~9 验证切换
- **预期**：切换正常（核对项）
- **优先级**：P3

#### T-REG-024 验证 paragraph.reset-paragraph 新增功能
- **关联差异**：DIFF-M-010 / DIFF-CMD-015
- **验证步骤**：输入标题块，光标置于该块，触发 Paragraph → Reset Paragraph
- **预期**：段落重置为普通段落（增强项）
- **优先级**：P3

#### T-REG-025 验证 tabs.cycleForward/Backward 新增快捷键
- **关联差异**：DIFF-K-008
- **验证步骤**：打开多个标签，按 Ctrl+Tab / Ctrl+Shift+Tab
- **预期**：循环切换正常（增强项）
- **优先级**：P3

#### T-REG-026 验证 window.alwaysOnTop checkbox 保留
- **关联差异**：DIFF-M-020
- **验证步骤**：展开 Window 菜单，勾选 Always On Top，验证窗口置顶
- **预期**：功能正常（核对项）
- **优先级**：P3

#### T-REG-027 验证 edit.copy-as-rich 一致性
- **关联差异**：DIFF-M-019
- **验证步骤**：选中文本，Edit → Copy As Rich，粘贴到外部富文本编辑器
- **预期**：保留富文本格式（核对项）
- **优先级**：P3

#### T-REG-028 验证 View.reloadImages 快捷键保留
- **关联差异**：DIFF-M-014 / DIFF-CMD-004
- **验证步骤**：含图片的文档，按 F5
- **预期**：图片重新加载（核对项，菜单丢失但快捷键可用）
- **优先级**：P3

---

## 第 6 章 总览统计

### 6.1 差异条目统计

| 章节 | CRITICAL | HIGH | MEDIUM | LOW | 合计 |
|---|---:|---:|---:|---:|---:|
| 第 1 章 菜单结构 | 3 | 4 | 7 | 6 | 20 |
| 第 2 章 快捷键 | 1 | 2 | 2 | 4 | 9 |
| 第 3 章 右键菜单 | 3 | 1 | 2 | 2 | 8 |
| 第 4 章 命令清单 | 2 | 5 | 4 | 4 | 15 |
| **合计** | **9** | **12** | **15** | **16** | **52** |

> **注意**：部分差异存在跨章节关联（如 DIFF-M-004 ↔ DIFF-CMD-007），统计时按所在章节独立计数，因此同一根因可能在多个章节累计。

### 6.2 差异类型分布

| 差异类型 | 数量 | 占比 |
|---|---:|---:|
| 缺失（菜单/命令/快捷键丢失） | 35 | 67% |
| 缺陷（行为错误/退化） | 5 | 10% |
| 变更（ID/类型/快捷键变更） | 6 | 12% |
| 新增（功能增强） | 6 | 12% |

### 6.3 三个用户预告知根因验证

| 根因 | 验证结果 | 关联差异 |
|---|---|---|
| CodeMirror `stopPropagation` 截断 DOM 事件 | 已确认，sourceCode.vue:377-380 | DIFF-C-001 |
| contextMenu/editor 主进程目录整体未移植 | 已确认，原版 3 文件 vs 移植版内联 | DIFF-C-002 |
| store/editor.ts IPC 监听器成孤儿 | 已确认 6 个监听器（line 1738-1756） | DIFF-C-003 |

### 6.4 E2E 回归用例分布

| 优先级 | 用例数 | 阻塞发布 |
|---|---:|---|
| P0（CRITICAL） | 6 | 是 |
| P1（HIGH） | 5 | 建议本版修复 |
| P2（MEDIUM） | 10 | 可纳入下版 |
| P3（LOW/核对/增强） | 7 | 不阻塞 |
| **合计** | **28** | |

### 6.5 修复优先级建议

**P0 本版必修（6 项）**：
1. 修复 sourceCode.vue:377-380 stopPropagation（T-REG-002）
2. 移植 contextMenu/editor 主进程目录或重构右键菜单逻辑（T-REG-003）
3. 实现或显式关闭 spellcheck 功能（T-REG-004）
4. 恢复 File.import-file 菜单项（T-REG-005）
5. 恢复 File.export-file-html 子菜单（T-REG-006）
6. 评估 Theme 菜单恢复方案（T-REG-001，可能纳入下版）

**P1 建议本版修复（5 项）**：
1. 恢复 edit.copy-as-html 菜单项（T-REG-007）
2. 恢复 Window.zoomIn/zoomOut 入口（T-REG-008）
3. 恢复 Edit.lineEnding 子菜单（T-REG-009）
4. 右键菜单标签接入 i18n（T-REG-010）
5. 恢复 File.autoSave checkbox（T-REG-011）

---

## 附录 A：文件位置索引

### A.1 原版项目（`C:\Work\202607\MarkText优化\marktext-develop\`）

| 文件 | 用途 |
|---|---|
| `packages/desktop/src/main/menu/templates/file.ts` | File 菜单模板 |
| `packages/desktop/src/main/menu/templates/edit.ts` | Edit 菜单模板 |
| `packages/desktop/src/main/menu/templates/paragraph.ts` | Paragraph 菜单模板 |
| `packages/desktop/src/main/menu/templates/format.ts` | Format 菜单模板 |
| `packages/desktop/src/main/menu/templates/theme.ts` | Theme 菜单模板 |
| `packages/desktop/src/main/menu/templates/view.ts` | View 菜单模板 |
| `packages/desktop/src/main/menu/templates/window.ts` | Window 菜单模板 |
| `packages/desktop/src/main/menu/templates/help.ts` | Help 菜单模板 |
| `packages/desktop/src/main/menu/templates/dock.ts` | macOS dock 菜单 |
| `packages/desktop/src/main/menu/templates/marktext.ts` | macOS 应用菜单 |
| `packages/desktop/src/main/menu/templates/prefEdit.ts` | 设置窗口菜单 |
| `packages/desktop/src/main/menu/templates/index.ts` | 菜单组装入口 |
| `packages/desktop/src/main/keyboard/keybindingsWindows.ts` | Windows 快捷键映射（54 项） |
| `packages/desktop/src/main/contextMenu/editor/index.ts` | 右键菜单组装 |
| `packages/desktop/src/main/contextMenu/editor/menuItems.ts` | 右键菜单项定义（8 项） |
| `packages/desktop/src/main/contextMenu/editor/spellcheck.ts` | 拼写检查子菜单 |

### A.2 移植版项目（`C:\Work\202607\MarkText优化\marktext-tauri\`）

| 文件 | 用途 |
|---|---|
| `src-tauri/src/commands/menu.rs` | Tauri 原生菜单定义（586 行，7 个菜单） |
| `src-tauri/capabilities/default.json` | Tauri 权限清单（34 行） |
| `src/renderer/src/commands/index.ts` | 命令注册中心（754 行，73+ 命令） |
| `src/renderer/src/commands/descriptions.ts` | 命令 i18n 描述映射（229 行，73 条） |
| `src/renderer/src/keyboardShortcuts.ts` | 快捷键映射与拦截器（232 行，57 项 + ALWAYS_FIRE 30 项） |
| `src/renderer/src/menuBridge.ts` | 菜单桥接逻辑（143 行，FORMAT/CHECKBOX/LAYOUT/HELP MAP） |
| `src/renderer/src/components/editorWithTabs/editor.vue` | 右键菜单实现（line 1592-1616） |
| `src/renderer/src/components/editorWithTabs/sourceCode.vue` | CodeMirror stopPropagation 缺陷（line 377-380） |
| `src/renderer/src/contextMenu/popupMenu.ts` | 右键菜单 Tauri IPC 弹出（92 行） |
| `src/renderer/src/store/editor.ts` | 6 个孤儿 IPC 监听器（line 1738-1756） |

---

*报告结束*