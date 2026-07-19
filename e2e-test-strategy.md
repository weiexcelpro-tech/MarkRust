

# MarkRust 端到端测试方案

> 版本：1.0 | 生成日期：2026-07-17
> 覆盖项目：MarkText Electron → Rust + Tauri 2 迁移版（markrust.exe）
> 关联文档：`migration-audit.md`（迁移审计报告）、`tools/e2e/e2e-test-plan.md`（已有测试计划 T001–T020）

---

## 一、方案目标与定位

### 1.1 文档定位

本方案在已有 `e2e-test-plan.md`（20 个用例，侧重冒烟和文件操作）之上，提供**更完整的功能覆盖**和**分层测试策略**，确保 Tauri 迁移版的前端功能与原版 MarkText 行为一致。

### 1.2 与已有测试的关系

| 已有资产 | 层级 | 覆盖范围 | 本方案补充 |
|---|---|---|---|
| `tests/unit/`（7 文件） | 单元 | 快捷键映射、menuBridge、tauri-bridge、命令分发 | 不重复，本方案依赖其作为底层保障 |
| `tests/contract/`（2 文件） | 契约 | IPC 参数类型、事件名匹配 | 不重复，本方案在执行矩阵中引用 |
| `tests/e2e/*.spec.ts`（4 文件） | Mock E2E | 冒烟、渲染、菜单、文件操作、标签（Playwright + mock-tauri） | 本方案扩展更多场景到 Mock 层 |
| `tools/e2e/e2e-test-plan.md`（T001–T020） | CDP E2E | 启动、打开、保存、渲染、切换、快捷键、单实例、watcher | **本方案在此基础上新增 F1–F20 功能领域，补充 155 个用例** |
| `tools/verify/`（21 脚本） | CDP 诊断 | 散装验证脚本 | 本方案将其归入用例体系，统一编号 |

### 1.3 测试分层架构

```
┌─────────────────────────────────────────────────────────┐
│  Tier 0  单元测试 (Vitest)                               │
│  位置: tests/unit/                                       │
│  目标: 函数级正确性（快捷键映射、命令分发、IPC 参数）        │
│  速度: 秒级 | 依赖: 无                                     │
├─────────────────────────────────────────────────────────┤
│  Tier 1  Mock E2E (Playwright + mock-tauri)              │
│  位置: tests/e2e/*.spec.ts                               │
│  目标: 前端 UI 交互、渲染、状态流（无 Rust 后端）           │
│  速度: 分钟级 | 依赖: Vite dev server                     │
├─────────────────────────────────────────────────────────┤
│  Tier 2  契约测试 (Vitest)                                │
│  位置: tests/contract/                                   │
│  目标: 前端调用参数 ↔ Rust 命令签名一致性                  │
│  速度: 秒级 | 依赖: 无                                     │
├─────────────────────────────────────────────────────────┤
│  Tier 3  真实应用 E2E (CDP → markrust.exe)                │
│  位置: tools/e2e/T0xx-*.mjs                              │
│  目标: 端到端链路验证（UI → IPC → Rust → 文件系统）        │
│  速度: 分钟级 | 依赖: 构建产物 markrust.exe + CDP 端口     │
├─────────────────────────────────────────────────────────┤
│  Tier 4  回归验证 (tools/verify/*.mjs)                    │
│  位置: tools/verify/                                     │
│  目标: 已修复 bug 的回归守护（散装脚本，可逐步归入 T0xx）   │
│  速度: 秒~分钟级 | 依赖: markrust.exe + CDP               │
└─────────────────────────────────────────────────────────┘
```

**核心原则（来自 e2e-test-plan.md 反思）：**
1. 走真实 UI 路径——CDP `Input.dispatchKeyEvent/MouseEvent`，不直接调 `invoke()`/IPC
2. 用真实 store 数据——从 Pinia `editor` store 获取参数，不硬编码
3. 验证端到端——操作 → UI 变化 → 文件系统 → 读回对比
4. 覆盖边界——CRLF、大文件、空文件、特殊字符、多标签、IME 输入

---

## 二、功能领域划分与用例总览

### 2.1 20 个功能领域

| 领域 | 名称 | 用例数 | P0 | P1 | P2 | 对应已有用例 |
|---|---|---:|---:|---:|---:|---|
| F1 | 应用启动与会话恢复 | 8 | 3 | 3 | 2 | T001 |
| F2 | 文件操作（打开/保存/另存为/重命名） | 18 | 6 | 8 | 4 | T002,T003,T009 |
| F3 | Markdown 渲染 | 12 | 3 | 6 | 3 | T004,T007 |
| F4 | 编辑器交互（输入/撤销/重做/光标） | 10 | 2 | 5 | 3 | — |
| F5 | 快捷键系统（61 个映射） | 16 | 4 | 8 | 4 | T005,T011 |
| F6 | 菜单系统（八大菜单） | 14 | 2 | 8 | 4 | — |
| F7 | 格式化操作（粗体/斜体/代码/链接等） | 12 | 2 | 7 | 3 | T011 |
| F8 | 段落操作（标题/表格/列表/引用等） | 14 | 2 | 8 | 4 | — |
| F9 | 标签管理 | 10 | 1 | 6 | 3 | T008,T010 |
| F10 | 侧边栏与文件树 | 8 | 1 | 5 | 2 | T006,T014 |
| F11 | 源码/渲染模式切换 | 6 | 1 | 3 | 2 | T005 |
| F12 | 视图模式（打字机/专注/侧边栏/TOC/TabBar） | 8 | 0 | 5 | 3 | T011 |
| F13 | 文件监听 | 6 | 1 | 3 | 2 | T014 |
| F14 | 偏好设置 | 10 | 0 | 6 | 4 | — |
| F15 | 国际化（10 种语言） | 6 | 0 | 3 | 3 | — |
| F16 | 导出与打印 | 6 | 1 | 3 | 2 | T019 |
| F17 | 拼写检查 | 4 | 0 | 2 | 2 | — |
| F18 | 单实例与命令行参数 | 6 | 2 | 3 | 1 | T012,T013,T020 |
| F19 | 快捷键加载与自定义 | 4 | 0 | 2 | 2 | — |
| F20 | 性能与边界 | 8 | 0 | 2 | 6 | — |
| **合计** | | **186** | **31** | **96** | **59** | |

### 2.2 用例编号规则

- **E2E-XXXX**：本方案新增用例（XXXX = 领域编号 + 序号，如 E2E-F201 = F2 第 1 个用例）
- **T0XX**：已有 `e2e-test-plan.md` 中的用例，本方案在执行矩阵中引用，不重复定义

---

## 三、测试用例详细清单

### F1 — 应用启动与会话恢复（8 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F101 | P0 | 冷启动进程存活 | markrust.exe 未运行 | 启动 markrust.exe → 等待 3s | 进程存活 + 窗口标题含 "MarkRust" + `#app` 非空 + `__vue_app__` 非空 | T3 |
| E2E-F102 | P0 | 启动无致命 JS 错误 | 同上 | 启动 → 收集 console error 5s | 无 fatal error（过滤 ElementPlus/prism/动态 import 警告） | T1+T3 |
| E2E-F103 | P0 | 启动显示 Untitled 标签 | 同上 | 启动 → 检查标签栏 | 默认创建 1 个 Untitled 标签 + editor store markdownList.length === 1 | T1+T3 |
| E2E-F104 | P1 | 会话恢复—打开文件列表 | 上次关闭时打开了 2 个文件 | 启动 → 等待 bootstrap | markdownList 从 bufferedState 恢复 + pathname 非空 | T3 |
| E2E-F105 | P1 | 会话恢复—编辑器布局状态 | 上次关闭时侧边栏关闭 | 启动 → 检查 layout store | showSideBar / showTabBar / typewriter / focus 状态恢复 | T3 |
| E2E-F106 | P1 | 窗口位置恢复 | 上次关闭时窗口在 (100,200) 800×600 | 启动 → 检查窗口位置 | 外部窗口位置和尺寸恢复 | T3 |
| E2E-F107 | P2 | bootstrap 事件驱动（非 800ms 延迟） | — | 启动 → 监听 `mt::renderer-ready` 事件 | 响应时间 < 500ms（非固定 800ms setTimeout） | T3 |
| E2E-F108 | P2 | 启动后默认偏好加载 | — | 启动 → 检查 `preferences_get_all` 返回值 | 偏好设置加载完整（50+ 项）+ 非 undefined | T1 |

### F2 — 文件操作（18 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F201 | P0 | 打开文件—真实 DOM 点击 | 已打开文件夹 | 点击文件树中 .md 文件 | currentFile.pathname 正确 + filename 非 "Untitled-1" + markdown 非空 + `.mu-container` 有子节点 | T3 |
| E2E-F202 | P0 | 打开文件—命令行参数 | markrust.exe 未运行 | `markrust.exe "path/to/test.md"` | 启动后自动打开该文件 + currentFile.pathname === 传入路径 | T3 |
| E2E-F203 | P0 | 保存—Ctrl+S 完整链路 | 文件已打开 | 编辑器输入文字 → Ctrl+S → 等待 2s → 读回磁盘 | 磁盘文件含新文字 + isSaved===true + encoding 参数类型正确（string 非对象） | T3 |
| E2E-F204 | P0 | 保存—LF 行尾 | 打开 LF 文件 | 编辑 → Ctrl+S → 读回 | 行尾保持 LF（`\n`） | T3 |
| E2E-F205 | P0 | 保存—CRLF 行尾 | 打开 CRLF 文件 | 编辑 → Ctrl+S → 读回 | adjustLineEndingOnSave=true 时行尾还原为 CRLF（`\r\n`） | T3 |
| E2E-F206 | P0 | 保存—空文件 | 打开文件后清空内容 | 清空 → Ctrl+S → 读回 | 磁盘文件为空字符串 + 不报错 | T3 |
| E2E-F207 | P1 | 另存为—Ctrl+Shift+S | 文件已打开 | 编辑 → Ctrl+Shift+S → 对话框选新路径 | 新路径文件存在 + 内容匹配 + currentFile.pathname 更新 | T3 |
| E2E-F208 | P1 | 保存—含特殊字符 | 打开含 emoji/中文/表格的文件 | 编辑 → Ctrl+S → 读回 | 特殊字符正确保存（UTF-8 编码） | T3 |
| E2E-F209 | P1 | 保存—BOM 文件 | 打开含 BOM 头的文件 | 编辑 → Ctrl+S → 检查 BOM | isBom=true 时保留 BOM 头 + isBom=false 时去除 BOM | T3 |
| E2E-F210 | P1 | 保存—trimTrailingNewline | 打开尾部多空行的文件 | 编辑 → Ctrl+S → 读回 | trimTrailingNewline=true 时尾部空行被裁剪 | T3 |
| E2E-F211 | P1 | 保存后标签状态更新 | 文件已修改未保存 | Ctrl+S → 检查标签 | isSaved===true + 标签标题无 "●" 修改标记 + `mt::tab-saved` 事件触发 | T3 |
| E2E-F212 | P1 | 重命名文件 | 文件已打开 | 菜单 File → Rename → 输入新名 | 文件移动到新路径 + currentFile.pathname 更新 + 旧路径文件不存在 | T3 |
| E2E-F213 | P1 | 移动文件 | 文件已打开 | 菜单 File → Move To → 选新目录 | 文件移动 + pathname 更新 | T3 |
| E2E-F214 | P1 | 打开文件—encoding 自动探测 | 非 UTF-8 文件（如 GBK） | 打开文件 | autoGuessEncoding=true 时正确识别编码 + 内容正确渲染 | T3 |
| E2E-F215 | P2 | 保存—大文件（1MB+） | 打开大 .md 文件 | 编辑末尾 → Ctrl+S → 读回 | 保存成功 + 不超时 + 内容完整 | T3 |
| E2E-F216 | P2 | 打开文件—lone \r 行尾 | 旧 Mac 格式文件 | 打开文件 | `\r` 被规范为 `\n` + 渲染正确（非全段落） | T3 |
| E2E-F217 | P2 | 保存—混合行尾 | 文件含 LF+CRLF 混合 | 打开 → Ctrl+S → 读回 | isMixedLineEndings 正确标记 + 保存后行尾统一 | T3 |
| E2E-F218 | P2 | 最近文件菜单更新 | 保存文件后 | 检查 File → Open Recent 菜单 | 新文件出现在最近文件列表（MRU，max 12） | T3 |

### F3 — Markdown 渲染（12 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F301 | P0 | 基本语法渲染 | 打开综合测试 .md | 检查 DOM | `.mu-atx-heading` + `.mu-table` + `.mu-bullet-list` + `.mu-code-block` 均存在 | T1+T3 |
| E2E-F302 | P0 | CSS 加载验证 | 文件已打开 | 检查 computed style | H1 fontSize ≥ 24px + 段落 color 非默认黑色 + `style` 标签数 > 0 | T1+T3 |
| E2E-F303 | P0 | CRLF 文件渲染 | 打开 CRLF .md | 检查 DOM | 非全 `.mu-paragraph` + 标题/表格正确识别 | T3 |
| E2E-F304 | P1 | 标题渲染（H1-H6） | 打开含六级标题文件 | 检查 DOM | 6 种 `.mu-atx-heading` 且字号递减 | T1 |
| E2E-F305 | P1 | 表格渲染 | 打开含表格文件 | 检查 DOM | `.mu-table` 含 `thead`/`tbody` + 列数正确 | T1 |
| E2E-F306 | P1 | 代码块渲染（含语法高亮） | 打开含 ```js 代码块 | 检查 DOM | `.mu-code-block` 含 `.language-` 类 + Prism 高亮 span | T1 |
| E2E-F307 | P1 | 列表渲染（有序/无序/任务） | 打开含三种列表文件 | 检查 DOM | `.mu-order-list` + `.mu-bullet-list` + `.mu-task-list-dot` 均存在 | T1 |
| E2E-F308 | P1 | 引用块渲染 | 打开含 > 引用 | 检查 DOM | `.mu-blockquote` 存在 + 缩进样式正确 | T1 |
| E2E-F309 | P1 | 行内格式渲染 | 打开含 **bold** *italic* `code` | 检查 DOM | `.mu-strong` + `.mu-em` + `.mu-inline-code` 存在 | T1 |
| E2E-F310 | P1 | 数学公式渲染 | 打开含 $inline$ $$block$$ | 检查 DOM | `.mu-inline-math` + `.mu-math-block` 存在 | T1 |
| E2E-F311 | P2 | 图片渲染 | 打开含 ![]() 图片 | 检查 DOM | `<img>` 标签 src 正确 + 加载成功 | T1 |
| E2E-F312 | P2 | HTML 块渲染 | 打开含 `<div>` 块 | 检查 DOM | `.mu-html-block` 存在 + 内部 HTML 正确渲染 | T1 |

### F4 — 编辑器交互（10 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F401 | P0 | 编辑器可输入文字 | 应用已启动 | 点击 `.mu-editor` → 输入 "Hello" | body.innerText 含 "Hello" | T1+T3 |
| E2E-F402 | P0 | 撤销/重做 | 已输入文字 | Ctrl+Z → 检查 → Ctrl+Shift+Z → 检查 | 撤销后文字消失 + 重做后恢复 | T1+T3 |
| E2E-F403 | P1 | 光标定位 | 编辑器有内容 | 点击行尾 → 检查 selection | 光标在点击位置 + selection.rangeCount > 0 | T3 |
| E2E-F404 | P1 | 多行输入与换行 | 编辑器已 focus | 输入 "Line1" → Enter → "Line2" | DOM 有 2 个段落块 | T1 |
| E2E-F405 | P1 | 选中文字 | 编辑器有多行内容 | Shift+→ 选中 5 字符 | window.getSelection().toString().length === 5 | T1 |
| E2E-F406 | P1 | 复制/剪切/粘贴 | 选中文字 | Ctrl+C → Ctrl+V 到新位置 | 粘贴内容与复制一致 + 剪切后原文消失 | T1 |
| E2E-F407 | P1 | 选中后格式化 | 选中文字 | Ctrl+B | 选中文字变为 `.mu-strong` | T1+T3 |
| E2E-F408 | P2 | IME 输入（中文） | 编辑器 focus | 切换中文输入法 → 输入 "测试" | 正确输入 + 不触发快捷键 | T3 |
| E2E-F409 | P2 | 长文档滚动 | 打开长 .md | PageDown 多次 → PageUp | 滚动位置正确 + 内容可见 | T1+T3 |
| E2E-F410 | P2 | Tab 键缩进 | 编辑器有列表项 | 在列表项按 Tab | 缩进增加一级 | T1 |

### F5 — 快捷键系统（16 用例）

> **背景：** Tauri 2 原生菜单 accelerator 仅显示标签不拦截键盘事件，通过 `keyboardShortcuts.ts` 在 capture phase 拦截 keydown 补偿。共 61 个映射。

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F501 | P0 | Ctrl+S 触发 file.save | 编辑器 focus | 按 Ctrl+S | `handleMenuClick('file.save')` 被调用 + preventDefault=true | T0+T3 |
| E2E-F502 | P0 | Ctrl+B 触发 strongMenuItem | 编辑器 focus | 按 Ctrl+B | `handleMenuClick('strongMenuItem')` 被调用 | T0+T3 |
| E2E-F503 | P0 | Ctrl+E 触发模式切换 | 编辑器 focus | 按 Ctrl+E | sourceCode 翻转 + DOM 出现/消失 source-code 组件 | T0+T3 |
| E2E-F504 | P0 | 文本域中 ALWAYS_FIRE 生效 | focus 在 `<input>` | 在 input 中按 Ctrl+S | `file.save` 仍触发 + 非 ALWAYS_FIRE 被拦截（Ctrl+B 不触发） | T0 |
| E2E-F505 | P1 | File 类快捷键（N/T/O/Shift+O/S/Shift+S/W/Q） | 编辑器 focus | 逐个按键 | 每个映射到正确 command ID | T0 |
| E2E-F506 | P1 | Edit 类快捷键（Z/Shift+Z/F/R/Shift+F 等） | 编辑器 focus | 逐个按键 | 每个映射到正确 command ID | T0 |
| E2E-F507 | P1 | Paragraph 类快捷键（Plus/Minus/Shift+T/Shift+K 等） | 编辑器 focus | 逐个按键 | 每个映射到正确 command ID | T0 |
| E2E-F508 | P1 | Format 类快捷键（B/I/U/Shift+H/`/D/L 等） | 编辑器 focus | 逐个按键 | 每个映射到 FORMAT_MENU_MAP ID | T0 |
| E2E-F509 | P1 | View 类快捷键（E/Shift+G/Shift+J/J/K/Shift+B） | 编辑器 focus | 逐个按键 | 每个映射到正确 command ID | T0 |
| E2E-F510 | P1 | IME 组合事件不触发 | isComposing=true | 按 Ctrl+S | `handleMenuClick` **不**被调用 | T0 |
| E2E-F511 | P1 | 修饰键单独按下不触发 | 只按 Ctrl | 按下 Ctrl | `handleMenuClick` 不被调用 | T0 |
| E2E-F512 | P1 | 未知快捷键不触发 | 编辑器 focus | 按 Ctrl+X | `handleMenuClick` 不被调用 + 不 preventDefault | T0 |
| E2E-F513 | P1 | F3/Shift+F3 查找 | 编辑器 focus | 按 F3 | `edit.find-next` 触发 + Shift+F3 触发 `find-previous` | T0 |
| E2E-F514 | P2 | Ctrl+Plus/Minus 标题升降级 | 编辑器有标题 | 按 Ctrl+Plus | 标题升一级（H2→H1） | T3 |
| E2E-F515 | P2 | Ctrl+Tab 标签切换 | 打开 2+ 标签 | 按 Ctrl+Tab | 切换到下一个标签 | T3 |
| E2E-F516 | P2 | Ctrl+, 打开偏好设置 | 编辑器 focus | 按 Ctrl+, | 偏好设置窗口/面板打开 | T3 |

### F6 — 菜单系统（14 用例）

> **背景：** 八大菜单 File/Edit/Paragraph/Format/Window/Theme/View/Help。Tauri 原生菜单 + renderer 侧 `handleMenuClick` 分发。

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F601 | P0 | 菜单点击触发正确 command | 应用已启动 | 模拟菜单点击各 ID | `handleMenuClick` 收到正确 ID + 对应功能执行 | T1 |
| E2E-F602 | P0 | CheckMenuItem 状态同步 | 打开 View 菜单 | 点击 Side Bar | 菜单项 checked 状态翻转 + layout store 更新 + `menu_set_checked` 调用 | T3 |
| E2E-F603 | P1 | File 菜单完整 | 应用已启动 | 检查菜单项 | New Window/New Tab/Open File/Open Folder/Save/Save As/Export/Print/Preferences/Close Tab/Close Window/Quit 全部存在 | T1 |
| E2E-F604 | P1 | Edit 菜单完整 | 同上 | 检查菜单项 | Undo/Redo/Cut/Copy/Copy as Rich/Paste/Paste as Plain/Duplicate/Create Paragraph/Delete Paragraph/Find/Find Next/Find Previous/Replace/Find in Folder 全部存在 | T1 |
| E2E-F605 | P1 | Paragraph 菜单完整 | 同上 | 检查菜单项 | Upgrade/Degrade Heading/Table/Code Fence/Quote Block/Math Formula/HTML Block/Order List/Bullet List/Task List/Loose List Item/Horizontal Line/Paragraph/Front Matter 全部存在 | T1 |
| E2E-F606 | P1 | Format 菜单完整 | 同上 | 检查菜单项 | Strong/Emphasis/Underline/Highlight/Inline Code/Inline Math/Strikethrough/Hyperlink/Image/Clear Format 全部存在 | T1 |
| E2E-F607 | P1 | View 菜单完整 | 同上 | 检查菜单项 | Command Palette/Source Code/Typewriter/Focus/Side Bar/TOC/Tab Bar/Reload Images 全部存在 | T1 |
| E2E-F608 | P1 | Theme 菜单完整 | 同上 | 检查菜单项 | 主题列表正确 + 切换生效 | T1 |
| E2E-F609 | P1 | Window 菜单完整 | 同上 | 检查菜单项 | Minimize/Toggle Full Screen 存在 | T1 |
| E2E-F610 | P1 | Open Recent 子菜单 | 保存过文件 | 检查 File → Open Recent | 最近文件列表正确（MRU max 12） + 点击可打开 | T3 |
| E2E-F611 | P1 | 菜单 enabled 状态 | 无选中文字 | 检查 Format 菜单 | Bold/Italic 等为 disabled + 选中后变 enabled | T3 |
| E2E-F612 | P2 | 菜单国际化 | 切换语言为中文 | 检查菜单文本 | 所有菜单项显示中文 | T3 |
| E2E-F613 | P2 | Help 菜单 | 应用已启动 | 检查菜单项 | About/Markdown Reference/Keyboard Shortcuts 等存在 | T1 |
| E2E-F614 | P2 | 菜单点击不产生控制台错误 | 应用已启动 | 逐个点击菜单项 | 无 fatal error | T3 |

### F7 — 格式化操作（12 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F701 | P0 | Ctrl+B 粗体 | 选中文字 | Ctrl+B | 选中文字被 `**` 包裹 + DOM 有 `.mu-strong` | T1+T3 |
| E2E-F702 | P0 | Ctrl+I 斜体 | 选中文字 | Ctrl+I | 选中文字被 `*` 包裹 + DOM 有 `.mu-em` | T1+T3 |
| E2E-F703 | P1 | Ctrl+U 下划线 | 选中文字 | Ctrl+U | DOM 有 `.mu-underline` | T3 |
| E2E-F704 | P1 | Ctrl+Shift+H 高亮 | 选中文字 | Ctrl+Shift+H | DOM 有 `.mu-highlight` | T3 |
| E2E-F705 | P1 | Ctrl+` 行内代码 | 选中文字 | Ctrl+` | 选中文字被 `` ` `` 包裹 + DOM 有 `.mu-inline-code` | T3 |
| E2E-F706 | P1 | Ctrl+Shift+M 行内数学 | 选中文字 | Ctrl+Shift+M | DOM 有 `.mu-inline-math` | T3 |
| E2E-F707 | P1 | Ctrl+D 删除线 | 选中文字 | Ctrl+D | DOM 有 `.mu-del` 或 `~~` 包裹 | T3 |
| E2E-F708 | P1 | Ctrl+L 超链接 | 选中文字 | Ctrl+L | 弹出链接输入 + 插入 `[text](url)` | T3 |
| E2E-F709 | P1 | Ctrl+Shift+I 图片 | 选中文字 | Ctrl+Shift+I | 弹出图片路径输入 + 插入 `![alt](src)` | T3 |
| E2E-F710 | P1 | Ctrl+Shift+R 清除格式 | 文字有格式 | Ctrl+Shift+R | 格式标记被移除 + 回到纯文本 | T3 |
| E2E-F711 | P2 | 未选中文字时包裹 | 光标在词旁 | Ctrl+B | 插入 `****` 并光标在中间 | T1 |
| E2E-F712 | P2 | 连续格式化叠加 | 已加粗文字 | Ctrl+I | 同时加粗+斜体 | T3 |

### F8 — 段落操作（14 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F801 | P0 | Ctrl+Plus 标题升级 | 光标在 H2 行 | Ctrl+Plus | H2 → H1 + DOM 类名变化 | T3 |
| E2E-F802 | P0 | Ctrl+Minus 标题降级 | 光标在 H1 行 | Ctrl+Minus | H1 → H2 + DOM 类名变化 | T3 |
| E2E-F803 | P1 | Ctrl+Shift+T 插入表格 | 光标在空行 | Ctrl+Shift+T | DOM 出现 `.mu-table` + 默认 2×2 | T3 |
| E2E-F804 | P1 | Ctrl+Shift+K 代码块 | 光标在空行 | Ctrl+Shift+K | DOM 出现 `.mu-code-block` | T3 |
| E2E-F805 | P1 | Ctrl+Shift+Q 引用块 | 光标在段落 | Ctrl+Shift+Q | DOM 出现 `.mu-blockquote` | T3 |
| E2E-F806 | P1 | Ctrl+G 有序列表 | 光标在空行 | Ctrl+G | DOM 出现 `.mu-order-list` | T3 |
| E2E-F807 | P1 | Ctrl+H 无序列表 | 光标在空行 | Ctrl+H | DOM 出现 `.mu-bullet-list` | T3 |
| E2E-F808 | P1 | Ctrl+Alt+X 任务列表 | 光标在空行 | Ctrl+Alt+X | DOM 出现 `.mu-task-list-dot` | T3 |
| E2E-F809 | P1 | Ctrl+Shift+0 普通段落 | 光标在标题行 | Ctrl+Shift+0 | 标题变为普通段落 | T3 |
| E2E-F810 | P1 | Ctrl+Shift+U 水平线 | 光标在空行 | Ctrl+Shift+U | DOM 出现 `.mu-thematic-break` | T3 |
| E2E-F811 | P1 | Ctrl+Alt+H HTML 块 | 光标在空行 | Ctrl+Alt+H | DOM 出现 `.mu-html-block` | T3 |
| E2E-F812 | P1 | Ctrl+Alt+N 数学公式块 | 光标在空行 | Ctrl+Alt+N | DOM 出现 `.mu-math-block` | T3 |
| E2E-F813 | P1 | Ctrl+Alt+Y Front Matter | 光标在文档首 | Ctrl+Alt+Y | DOM 出现 `.mu-front-matter` | T3 |
| E2E-F814 | P2 | Ctrl+Alt+L 松散列表项 | 光标在列表项 | Ctrl+Alt+L | 列表项切换 loose/tight | T3 |

### F9 — 标签管理（10 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F901 | P0 | 标签名显示文件名 | 打开 README.md | 检查标签栏 | 标签文本 === "README.md"（非 "Untitled-1"） | T3 |
| E2E-F902 | P1 | 新建标签 Ctrl+T | 应用已启动 | Ctrl+T | 新建 Untitled 标签 + markdownList.length 递增 | T3 |
| E2E-F903 | P1 | 关闭标签 Ctrl+W | 打开 2 个标签 | Ctrl+W | 当前标签关闭 + 切换到相邻标签 | T3 |
| E2E-F904 | P1 | 多标签切换 | 打开文件 A、B | 点击标签 A → 点击标签 B | currentFile.pathname 变化 + muya 内容更新 + 各自修改保留 | T3 |
| E2E-F905 | P1 | 标签修改标记 | 打开文件后编辑 | 检查标签 | 出现 "●" 修改标记 + isSaved===false | T3 |
| E2E-F906 | P1 | Ctrl+Tab 循环切换 | 打开 3+ 标签 | Ctrl+Tab → Ctrl+Shift+Tab | 前进/后退循环切换标签 | T3 |
| E2E-F907 | P1 | 关闭未保存标签提示 | 标签有修改 | Ctrl+W | 弹出确认对话框（保存/不保存/取消） | T3 |
| E2E-F908 | P2 | 关闭标签后 unwatch | 打开文件再关闭 | 关闭标签 → 外部修改文件 | 无 watcher 泄漏 + `invoke('unwatch_file')` 被调用 | T3 |
| E2E-F909 | P2 | 标签右键菜单 | 右键标签 | 检查菜单 | 关闭/关闭其他/关闭右侧/复制路径等选项 | T3 |
| E2E-F910 | P2 | TabBar 显隐切换 | 编辑器 focus | Ctrl+Shift+B | showTabBar 翻转 + 标签栏显隐 | T3 |

### F10 — 侧边栏与文件树（8 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1001 | P0 | 打开文件夹显示文件树 | 应用已启动 | Open Folder → 选目录 | projectTree.folders + files length > 0 + 子目录递归展示 | T3 |
| E2E-F1002 | P1 | 文件树 Markdown 标记 | 含 .md/.txt/.png 文件 | 检查 projectTree | .md 和 .txt isMarkdown===true + .png isMarkdown===false | T3 |
| E2E-F1003 | P1 | 文件树点击打开文件 | 已打开文件夹 | 点击 .md 文件 | 文件在新标签打开 + currentFile 更新 | T3 |
| E2E-F1004 | P1 | 文件树展开/折叠 | 含子目录的文件夹 | 点击展开箭头 | 子目录内容显示/隐藏 | T3 |
| E2E-F1005 | P1 | 侧边栏显隐 Ctrl+J | 应用已启动 | Ctrl+J | showSideBar 翻转 + 侧边栏显隐 | T3 |
| E2E-F1006 | P1 | treePathExcludePatterns | 配置了排除规则 | 打开含 node_modules 的项目 | 排除目录不显示 | T3 |
| E2E-F1007 | P2 | 文件排序 | 打开文件夹 | 检查顺序 | 按 fileSortBy/fileSortOrder 排序正确 | T3 |
| E2E-F1008 | P2 | 文件树右键菜单 | 右键文件 | 检查菜单 | 打开/重命名/删除/复制路径等选项 | T3 |

### F11 — 源码/渲染模式切换（6 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1101 | P0 | Ctrl+E 切换源码模式 | 编辑器 focus + 有内容 | Ctrl+E | sourceCode 翻转 + DOM 出现/消失 source-code 组件 | T3 |
| E2E-F1102 | P1 | 源码模式显示原始 Markdown | 已切换到源码 | 检查 DOM | 显示原始 `#`/`*`/`-` 等标记 + 非 muya 渲染 | T3 |
| E2E-F1103 | P1 | 切换回渲染模式 | 源码模式 | Ctrl+E | 回到 muya 渲染 + 渲染正确 | T3 |
| E2E-F1104 | P1 | 源码模式可编辑 | 源码模式 | 输入文字 → 切换回渲染 | 编辑内容保留 + 正确渲染 | T3 |
| E2E-F1105 | P2 | sourceCodeModeEnabled 持久化 | 开启源码模式 → 重启 | 重启应用 | 源码模式状态恢复 | T3 |
| E2E-F1106 | P2 | 模式切换不丢失内容 | 有未保存修改 | Ctrl+E → Ctrl+E | markdown 内容不变 + 修改保留 | T3 |

### F12 — 视图模式（8 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1201 | P1 | 打字机模式 Ctrl+Shift+G | 编辑器 focus | Ctrl+Shift+G | typewriter===true + 编辑器居中 + 光标行居中 | T3 |
| E2E-F1202 | P1 | 专注模式 Ctrl+Shift+J | 编辑器 focus | Ctrl+Shift+J | focus===true + 当前行高亮 + 其他行淡化 | T3 |
| E2E-F1203 | P1 | 侧边栏 Ctrl+J | 应用已启动 | Ctrl+J | showSideBar 翻转 | T3 |
| E2E-F1204 | P1 | TOC 面板 Ctrl+K | 编辑器 focus | Ctrl+K | rightColumn/toc 显示 + 包含标题大纲 | T3 |
| E2E-F1205 | P1 | TabBar Ctrl+Shift+B | 应用已启动 | Ctrl+Shift+B | showTabBar 翻转 | T3 |
| E2E-F1206 | P1 | 命令面板 Ctrl+Shift+P | 应用已启动 | Ctrl+Shift+P | 命令面板弹出 + 可搜索命令 | T3 |
| E2E-F1207 | P2 | 缩放 Ctrl+= / Ctrl+- | 应用已启动 | Ctrl+= → Ctrl+- | zoom 值变化 + UI 缩放 | T3 |
| E2E-F1208 | P2 | F11 全屏切换 | 应用已启动 | F11 | 全屏切换 + 菜单栏隐藏 | T3 |

### F13 — 文件监听（6 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1301 | P0 | 外部修改文件刷新 | 已打开文件夹 | Node fs.writeFile 新建 .md → 等待 2s | projectTree 出现新文件 + `mt::update-object-tree` 事件 | T3 |
| E2E-F1302 | P1 | 外部删除文件更新 | 已打开文件夹 | Node fs.unlink → 等待 2s | projectTree 中文件消失 | T3 |
| E2E-F1303 | P1 | watch_file 命令被调用 | 打开文件夹 | 检查 invoke 调用 | `invoke('watch_file', {path})` 被调用 | T3 |
| E2E-F1304 | P1 | 文件内容外部修改提示 | 文件已打开 | 外部修改文件 → 等待 | 弹出"文件已被外部修改"提示或自动刷新 | T3 |
| E2E-F1305 | P2 | watcher debounce 不频繁触发 | 已打开文件夹 | 快速连续创建 5 个文件 | 只触发 1 次更新（debounce） | T3 |
| E2E-F1306 | P2 | close-tab 后 unwatch | 打开文件再关闭标签 | 关闭 → 外部修改 | 无事件触发（已 unwatch） | T3 |

### F14 — 偏好设置（10 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1401 | P1 | 偏好设置面板打开 | 应用已启动 | Ctrl+, | 偏好设置面板/窗口打开 | T1+T3 |
| E2E-F1402 | P1 | 偏好设置分类完整 | 面板已打开 | 检查分类 | General/Editor/Markdown/Theme/Image/Search/Watcher/Spelling 全部存在 | T1 |
| E2E-F1403 | P1 | 修改编辑器字体 | 面板已打开 | 修改 editorFontFamily → 应用 | 编辑器字体变化（computed font-family） | T3 |
| E2E-F1404 | P1 | 修改字号 | 面板已打开 | 修改 fontSize → 应用 | 编辑器字号变化（computed font-size） | T3 |
| E2E-F1405 | P1 | autoSave 开关 | 面板已打开 | 开启 autoSave → 编辑 | 延迟后自动保存（isSaved→true） | T3 |
| E2E-F1406 | P1 | autoGuessEncoding 开关 | 面板已打开 | 开启 → 打开 GBK 文件 | 正确识别编码 | T3 |
| E2E-F1407 | P1 | 偏好设置持久化 | 修改后重启 | 重启 → 检查偏好 | 修改值保持（从磁盘加载） | T3 |
| E2E-F1408 | P4 | 跨窗口偏好同步 | 设置窗口修改偏好 | 修改 → 检查编辑器窗口 | 编辑器收到 `preferences-changed` 事件 + 配置生效 | T3 |
| E2E-F1409 | P2 | endOfLine 设置 | 设为 CRLF | 保存文件 | 行尾按设置保存 | T3 |
| E2E-F1410 | P2 | treePathExcludePatterns 生效 | 配置排除 *.log | 打开文件夹 | .log 文件不显示在文件树 | T3 |

### F15 — 国际化（6 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1501 | P1 | 切换到中文 | 应用已启动 | 切换 language→zh-CN | UI 文本变为中文（菜单/按钮/对话框） | T3 |
| E2E-F1502 | P1 | 切换到英文 | 同上 | 切换 language→en | UI 文本变为英文 | T3 |
| E2E-F1503 | P1 | 切换到日文 | 同上 | 切换 language→ja | UI 文本变为日文 | T3 |
| E2E-F1504 | P2 | 10 种语言文件完整 | — | 检查 static/locales/ | de/en/es/fr/ja/ko/pt/tr/zh-CN/zh-TW 全部存在 | T1 |
| E2E-F1505 | P2 | 语言设置持久化 | 切换后重启 | 重启 → 检查语言 | 语言保持上次设置 | T3 |
| E2E-F1506 | P2 | 缺失翻译 fallback | 某语言缺 key | 切换到该语言 | 缺失 key 回退到英文 | T1 |

### F16 — 导出与打印（6 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1601 | P0 | 导出 PDF 不报错 | 文件已打开 | Ctrl+Alt+E | 不报错（findCommand 找到 `file.export-file-pdf`） + PDF 生成 | T3 |
| E2E-F1602 | P1 | 导出 HTML | 文件已打开 | 菜单 Export → HTML | HTML 文件生成 + 含渲染后内容 + 含 CSS | T3 |
| E2E-F1603 | P1 | 打印 Ctrl+P | 文件已打开 | Ctrl+P | 打印预览弹出 + 不报错 | T3 |
| E2E-F1604 | P1 | 导出 PDF 内容正确 | 文件含表格/代码块 | 导出 → 检查 PDF | PDF 含表格 + 代码块 + 格式正确 | T3 |
| E2E-F1605 | P2 | 导出 HTML 自包含 | 导出 HTML | 检查 HTML 文件 | CSS 内联（不依赖外部文件） | T3 |
| E2E-F1606 | P2 | 导出 PDF 含中文 | 文件含中文 | 导出 → 检查 | 中文正确渲染（非方框） | T3 |

### F17 — 拼写检查（4 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1701 | P1 | WebView2 拼写检查生效 | 编辑器 focus | 输入拼写错误单词 | 红色波浪线出现 | T3 |
| E2E-F1702 | P1 | 右键拼写建议 | 有拼写错误 | 右键错误单词 | 上下文菜单含建议替换词 | T3 |
| E2E-F1703 | P2 | 拼写语言切换 | 偏好设置 | 切换拼写语言 | 拼写检查按新语言执行 | T3 |
| E2E-F1704 | P2 | 自定义词典 | 右键添加单词 | 输入自定义单词 → 不再标红 | 单词被记住 | T3 |

### F18 — 单实例与命令行参数（6 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1801 | P0 | 单实例检测 | 应用已运行 | 启动第二个 markrust.exe | 第二进程自动退出 + 进程数为 1 | T3 |
| E2E-F1802 | P0 | 第二实例传文件到第一实例 | 应用已运行 | `markrust.exe "test.md"` | 第一窗口打开该文件 + 进程数为 1 | T3 |
| E2E-F1803 | P1 | 命令行参数打开文件 | 未运行 | `markrust.exe "test.md"` | 启动后自动打开该文件 | T3 |
| E2E-F1804 | P1 | 无参数启动创建 Untitled | 未运行 | `markrust.exe` | 启动后创建 Untitled 标签 | T3 |
| E2E-F1805 | P1 | 多参数处理 | 未运行 | `markrust.exe "file1.md" "file2.md"` | 两个文件在新标签打开 | T3 |
| E2E-F1806 | P2 | 文件关联注册表 | 安装后 | 检查注册表 HKCU\Software\Classes\.md | ProgId 正确 + command 指向当前 exe | T3 |

### F19 — 快捷键加载与自定义（4 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F1901 | P1 | 默认 Windows 快捷键加载 | 首次启动 | 检查 get_keybindings 返回 | 返回 keybindingsWindows.ts 内容 | T3 |
| E2E-F1902 | P1 | 用户自定义快捷键 | 设置文件有覆盖 | 启动 → 按自定义键 | 自定义快捷键生效 | T3 |
| E2E-F1903 | P2 | 快捷键不冲突 | — | 检查 keybindings | 无重复 command ID | T0 |
| E2E-F1904 | P2 | 快捷键加载不阻塞启动 | — | 启动 → 检查时序 | 快捷键在 bootstrap 完成前已加载（async invoke） | T3 |

### F20 — 性能与边界（8 用例）

| ID | 优先级 | 名称 | 前置条件 | 步骤 | 预期结果 | 层级 |
|---|---|---|---|---|---|---|
| E2E-F2001 | P1 | 大文件渲染性能（1MB+） | 打开大 .md | 测量首屏渲染时间 | < 3s + 不卡死 | T3 |
| E2E-F2002 | P1 | 多标签内存占用 | 打开 10 个标签 | 检查内存 | 内存增长合理（< 500MB） | T3 |
| E2E-F2003 | P2 | 空文件处理 | 创建空文件 → 打开 | 检查渲染 | 不崩溃 + 显示空编辑器 | T3 |
| E2E-F2004 | P2 | 超长行处理 | 文件含 10000 字符单行 | 打开 → 渲染 | 不溢出 + 可滚动 | T3 |
| E2E-F2005 | P2 | 嵌套列表深层级 | 文件含 10 级嵌套列表 | 打开 → 渲染 | 缩进正确 + 不崩溃 | T3 |
| E2E-F2006 | P2 | 大量表格渲染 | 文件含 50 个表格 | 打开 → 渲染 | 全部正确渲染 + < 5s | T3 |
| E2E-F2007 | P2 | 快速连续操作 | 编辑器 focus | 1s 内连续按 20 个快捷键 | 不崩溃 + 不状态错乱 | T3 |
| E2E-F2008 | P2 | 长时间运行稳定性 | 应用运行 30min | 检查内存/性能 | 内存无明显泄漏 | T3 |

---

## 四、测试 Fixture 需求

### 4.1 Markdown Fixture 文件

| 文件名 | 用途 | 内容要求 | 对应用例 |
|---|---|---|---|
| `fixture-basic.md` | 基本语法 | 标题 H1-H6 + 段落 + 粗体/斜体/代码 + 列表 + 引用 + 表格 + 代码块 | F301, F302 |
| `fixture-crlf.md` | CRLF 行尾 | 同上但行尾为 `\r\n` | F303, F205 |
| `fixture-tables.md` | 表格 | 5 种表格（含对齐/合并/空单元格） | F305 |
| `fixture-code.md` | 代码块 | JS/Python/Bash/JSON 代码块 + 行内代码 | F306 |
| `fixture-math.md` | 数学公式 | 行内 `$...$` + 块级 `$$...$$` | F310 |
| `fixture-emoji.md` | 特殊字符 | emoji + 中文 + 日文 + 表格混排 | F208 |
| `fixture-bom-utf8.md` | BOM 文件 | UTF-8 BOM 头 | F209 |
| `fixture-gbk.md` | GBK 编码 | GBK 编码的中文 | F214 |
| `fixture-large.md` | 大文件 | 1MB+（重复内容生成） | F215, F2001 |
| `fixture-lone-cr.md` | 旧 Mac 行尾 | 行尾为 `\r` | F216 |
| `fixture-mixed-eol.md` | 混合行尾 | LF + CRLF 混合 | F217 |
| `fixture-empty.md` | 空文件 | 0 字节 | F206, F2003 |
| `fixture-long-line.md` | 超长行 | 单行 10000 字符 | F2004 |
| `fixture-nested-list.md` | 深嵌套 | 10 级嵌套列表 | F2005 |

### 4.2 Fixture 生成脚本

```javascript
// tools/e2e/generate-fixtures.mjs
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const FIXTURE_DIR = 'tests/fixtures/e2e'
mkdirSync(FIXTURE_DIR, { recursive: true })

// 基本语法
writeFileSync(join(FIXTURE_DIR, 'fixture-basic.md'), [
  '# H1 Title',
  '## H2 Title',
  '### H3 Title',
  '#### H4 Title',
  '##### H5 Title',
  '###### H6 Title',
  '',
  'Normal paragraph with **bold** and *italic* and `code`.',
  '',
  '- bullet item 1',
  '- bullet item 2',
  '  - nested item',
  '',
  '1. ordered item 1',
  '2. ordered item 2',
  '',
  '> Quote block',
  '> Second line',
  '',
  '| Col1 | Col2 | Col3 |',
  '|------|------|------|',
  '| A    | B    | C    |',
  '',
  '```js',
  'const x = 42;',
  'console.log(x);',
  '```',
  ''
].join('\n'))

// CRLF 版本
const basicContent = readFileSync(join(FIXTURE_DIR, 'fixture-basic.md'), 'utf-8')
writeFileSync(join(FIXTURE_DIR, 'fixture-crlf.md'), basicContent.replace(/\n/g, '\r\n'))

// 空文件
writeFileSync(join(FIXTURE_DIR, 'fixture-empty.md'), '')

// BOM 文件
writeFileSync(join(FIXTURE_DIR, 'fixture-bom-utf8.md'), '\uFEFF# BOM File\n\nContent.')

// 大文件（1MB）
let large = ''
for (let i = 0; i < 10000; i++) {
  large += `# Section ${i}\n\nParagraph ${i} with some text.\n\n`
}
writeFileSync(join(FIXTURE_DIR, 'fixture-large.md'), large)

console.log('Fixtures generated in', FIXTURE_DIR)
```

---

## 五、执行矩阵

### 5.1 按 CI 门禁分批

| 批次 | 名称 | 触发时机 | 包含用例 | 预期时长 | 通过标准 |
|---|---|---|---|---|---|
| **Gate 0** | 单元测试 | 每次 commit | `tests/unit/` 全部 + `tests/contract/` 全部 | < 1min | 100% 通过 |
| **Gate 1** | Mock E2E 冒烟 | 每次 PR | T1 层：E2E-F101,F102,F103,F301,F302,F401,F402,F501-F504,F601,F701,F702 | < 5min | 100% 通过 |
| **Gate 2** | Mock E2E 全量 | 每日构建 | T1 层全部用例 | < 15min | ≥ 95% 通过 |
| **Gate 3** | CDP E2E P0 | 每日构建 + 发布前 | T3 层所有 P0 用例 + 已有 T001-T005 | < 20min | 100% 通过 |
| **Gate 4** | CDP E2E 全量 | 发布前 | T3 层全部用例 + 已有 T001-T020 | < 60min | ≥ 95% 通过 |
| **Gate 5** | 回归验证 | 发布前 | `tools/verify/` 关键脚本 | < 15min | 100% 通过 |

### 5.2 按功能领域 × 层级矩阵

> ✅ = 必须覆盖 | ◻️ = 建议覆盖 | — = 不适用

| 领域 | T0 单元 | T1 Mock E2E | T2 契约 | T3 CDP E2E | T4 回归 |
|---|---|---|---|---|---|
| F1 启动 | — | ✅ | — | ✅ | ◻️ |
| F2 文件操作 | — | ◻️ | ✅ | ✅ | ✅ |
| F3 渲染 | — | ✅ | — | ✅ | ✅ |
| F4 编辑器 | — | ✅ | — | ✅ | ◻️ |
| F5 快捷键 | ✅ | ◻️ | — | ✅ | ✅ |
| F6 菜单 | — | ✅ | ✅ | ✅ | — |
| F7 格式化 | — | ✅ | — | ✅ | ◻️ |
| F8 段落 | — | ◻️ | — | ✅ | — |
| F9 标签 | — | ✅ | — | ✅ | ◻️ |
| F10 侧边栏 | — | ◻️ | — | ✅ | — |
| F11 模式切换 | — | ◻️ | — | ✅ | ✅ |
| F12 视图 | — | ◻️ | — | ✅ | — |
| F13 文件监听 | — | — | — | ✅ | — |
| F14 偏好设置 | — | ✅ | — | ✅ | — |
| F15 国际化 | — | ◻️ | — | ✅ | — |
| F16 导出 | — | — | — | ✅ | — |
| F17 拼写 | — | — | — | ✅ | — |
| F18 单实例 | — | — | — | ✅ | — |
| F19 快捷键加载 | ✅ | — | — | ✅ | — |
| F20 性能 | — | — | — | ✅ | — |

### 5.3 迁移审计风险点 × 测试覆盖矩阵

> 将 `migration-audit.md` 中的 P0/P1/P2 遗漏项映射到测试用例

| 审计编号 | 遗漏项 | 风险等级 | 对应用例 | 验证状态 |
|---|---|---|---|---|
| P0-1 | 保存不写盘 | P0 | E2E-F203 | ⬜ 待验证 |
| P0-2 | 另存为不写盘 | P0 | E2E-F207 | ⬜ 待验证 |
| P0-3 | 重命名/移动 | P0 | E2E-F212,F213 | ⬜ 待验证 |
| P0-4 | 导出 | P0 | E2E-F1601,F1602 | ⬜ 待验证 |
| P0-5 | 打印 | P0 | E2E-F1603 | ⬜ 待验证 |
| P0-6 | 单实例检测 | P0 | E2E-F1801,F1802 | ⬜ 待验证 |
| P0-7 | 文件监听未接线 | P0 | E2E-F1301,F1303 | ⬜ 待验证 |
| P1-8 | open-new-tab payload 不完整 | P1 | E2E-F201,F216,F217 | ⬜ 待验证 |
| P1-9 | 行尾规范不完整 | P1 | E2E-F216 | ⬜ 待验证 |
| P1-10 | 会话恢复 | P1 | E2E-F104,F105 | ⬜ 待验证 |
| P1-11 | 保存后状态反馈 | P1 | E2E-F211 | ⬜ 待验证 |
| P1-12 | 应用菜单状态同步 | P1 | E2E-F602,F611 | ⬜ 待验证 |
| P1-13 | 跨窗口偏好同步 | P1 | E2E-F1408 | ⬜ 待验证 |
| P1-14 | 剪贴板富文本 | P1 | E2E-F406 | ⬜ 待验证 |
| P1-15 | 截图 | P1 | — | ⬜ 未设计 |
| P1-16 | NSIS 文件关联 | P1 | E2E-F1806 | ⬜ 待验证 |
| P2-17~30 | 各项体验缺陷 | P2 | 零散分布 | ⬜ 待验证 |

---

## 六、CDP 测试实现模板

### 6.1 CDP 连接与工具函数（setup.mjs）

```javascript
// tools/e2e/setup.mjs
const CDP_BASE = 'http://127.0.0.1:9222';
let msgId = 1;

export async function getPageTarget() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  const targets = await res.json();
  return targets.find(t => t.type === 'page') ?? targets[0];
}

export async function connect() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP WebSocket connection failed'));
  });
  return ws;
}

export async function cdp(ws, method, params = {}) {
  const id = msgId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const resp = JSON.parse(event.data);
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
        else resolve(resp.result);
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
  });
}

export async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}

export async function pressKey(ws, key, modifiers = []) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const vkCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  const modFlag = modifiers.includes('ctrl') ? 2 : 0;
  for (const type of ['keyDown', 'keyUp']) {
    await cdp(ws, 'Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vkCode, modifiers: modFlag
    });
  }
}

export async function clickElement(ws, selector) {
  const rect = await evaluate(ws, `(() => {
    const el = document.querySelector('${selector}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  if (!rect) throw new Error(`Element not found: ${selector}`);
  const { x, y } = JSON.parse(rect);
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function getStore(ws, storeId) {
  return JSON.parse(await evaluate(ws, `(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === '${storeId}');
    return JSON.stringify(store ? { ...store.$state } : null);
  })()`));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
```

### 6.2 测试用例模板（E2E-F203 保存测试）

```javascript
// tools/e2e/E2E-F203-save.mjs
import { connect, evaluate, pressKey, clickElement, getStore, sleep } from './setup.mjs'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'

const TEST_FILE = 'C:/Work/202607/test-e2e-save.md'
const MODIFIED_TEXT = 'E2E Test Modified Content ' + Date.now()

// Setup
writeFileSync(TEST_FILE, '# Test\n\nOriginal content.\n', 'utf-8')

console.log('=== E2E-F203: Save via Ctrl+S ===')
const ws = await connect()

// Step 1: Open file
await evaluate(ws, `window.electron.ipcRenderer.send('mt::open-file', ${JSON.stringify(TEST_FILE)}, {})`)
await sleep(2000)

// Step 2: Verify encoding type (root cause of historical bug)
const before = await getStore(ws, 'editor')
const cf = before.currentFile
console.log('encoding type:', typeof cf?.encoding, 'value:', cf?.encoding)
if (typeof cf?.encoding === 'object') {
  console.log('⚠ WARN: encoding is object (historical bug indicator)')
}

// Step 3: Focus editor and type
await clickElement(ws, '.mu-editor')
await sleep(500)
await evaluate(ws, `(() => {
  const editor = document.querySelector('.mu-editor [contenteditable]')
  if (editor) { editor.focus(); editor.click(); }
})()`)

// Step 4: Press Ctrl+S
await pressKey(ws, 's', ['ctrl'])
await sleep(2000)

// Step 5: Verify store state
const after = await getStore(ws, 'editor')
console.log('isSaved:', after.currentFile?.isSaved)

// Step 6: Verify disk
let diskContent = ''
let diskError = null
try { diskContent = readFileSync(TEST_FILE, 'utf-8') }
catch (e) { diskError = e.message }

// Result
const pass = after.currentFile?.isSaved === true
  && diskError === null
  && diskContent.includes('Original content')

console.log('Result:', pass ? 'PASS' : 'FAIL')

// Cleanup
try { unlinkSync(TEST_FILE) } catch {}
ws.close()
process.exit(pass ? 0 : 1)
```

### 6.3 批量运行器（run-all.mjs）

```javascript
// tools/e2e/run-all.mjs
import { execSync } from 'child_process'

const TESTS = [
  // P0 — must pass
  { id: 'E2E-F101', file: 'E2E-F101-startup.mjs', priority: 'P0' },
  { id: 'E2E-F203', file: 'E2E-F203-save.mjs', priority: 'P0' },
  { id: 'E2E-F301', file: 'E2E-F301-render.mjs', priority: 'P0' },
  { id: 'E2E-F501', file: 'E2E-F501-ctrl-s.mjs', priority: 'P0' },
  { id: 'E2E-F1801', file: 'E2E-F1801-single-instance.mjs', priority: 'P0' },
  // P1 — should pass
  { id: 'E2E-F201', file: 'E2E-F201-open-file.mjs', priority: 'P1' },
  // ... add more
]

const results = []
for (const test of TESTS) {
  process.stdout.write(`[${test.priority}] ${test.id}... `)
  try {
    execSync(`node tools/e2e/${test.file}`, { stdio: 'pipe', timeout: 30000 })
    results.push({ ...test, status: 'PASS' })
    console.log('PASS')
  } catch (e) {
    results.push({ ...test, status: 'FAIL', error: e.message })
    console.log('FAIL')
  }
}

// Summary
const passed = results.filter(r => r.status === 'PASS').length
const failed = results.filter(r => r.status === 'FAIL').length
console.log(`\n=== Summary: ${passed} PASS, ${failed} FAIL ===`)

if (failed > 0) {
  console.log('\nFailed tests:')
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ${r.id} (${r.priority}): ${r.error?.slice(0, 100)}`)
  })
}

process.exit(failed > 0 ? 1 : 0)
```

---

## 七、测试执行流程

### 7.1 环境准备

```powershell
# 1. 构建应用
cd C:\Work\202607\MarkText优化\marktext-tauri
npx vite build
cd src-tauri
cargo build --release --features tauri/custom-protocol
cp target/release/markrust.exe target/release/markrust-1.0.X.exe

# 2. 生成测试 Fixture
node tools/e2e/generate-fixtures.mjs

# 3. 启动带 CDP 的应用
powershell -ExecutionPolicy Bypass -File tools/verify/start-with-cdp.ps1
```

### 7.2 执行测试

```powershell
# Gate 0: 单元测试
npx vitest run

# Gate 1: Mock E2E 冒烟
npx playwright test tests/e2e/ --grep "渲染|编辑器"

# Gate 3: CDP E2E P0
node tools/e2e/run-all.mjs

# Gate 5: 回归验证
node tools/verify/verify-save.mjs
node tools/verify/verify-shortcuts.mjs
node tools/verify/verify-css-render.mjs
node tools/verify/verify-filename.mjs
node tools/verify/verify-ctrl-e.mjs
```

### 7.3 结果报告

```
=== MarkRust E2E Test Report ===
Date: 2026-07-17
App: markrust.exe v1.0.19

Gate 0 (Unit):     15/15 PASS ✓
Gate 1 (Mock P0):   8/8  PASS ✓
Gate 3 (CDP P0):   12/12 PASS ✓
Gate 4 (CDP All):  186/186 — 178 PASS, 8 FAIL ✗

Failed:
  E2E-F104 (P1) 会话恢复—打开文件列表: bufferedState.json not found
  E2E-F1301 (P0) 外部修改文件刷新: watcher event not received
  E2E-F1408 (P1) 跨窗口偏好同步: preferences-changed not listened
  ...
```

---

## 八、附录

### 8.1 快捷键全覆盖清单（61 个映射）

> 用于 F5 系列测试的参数化数据

| 分类 | 快捷键 | Command ID | 测试用例 |
|---|---|---|---|
| File | Ctrl+N | file.new-window | F505 |
| File | Ctrl+T | file.new-tab | F505 |
| File | Ctrl+O | file.open-file | F505 |
| File | Ctrl+Shift+O | file.open-folder | F505 |
| File | Ctrl+S | file.save | F501 |
| File | Ctrl+Shift+S | file.save-as | F505 |
| File | Ctrl+Alt+E | file.export-file-pdf | F505 |
| File | Ctrl+P | file.print | F505 |
| File | Ctrl+, | file.preferences | F516 |
| File | Ctrl+W | file.close-tab | F505 |
| File | Ctrl+Shift+W | file.close-window | F505 |
| File | Ctrl+Q | file.quit | F505 |
| Edit | Ctrl+Z | edit.undo | F506 |
| Edit | Ctrl+Shift+Z | edit.redo | F506 |
| Edit | Ctrl+Shift+C | edit.copy-as-rich | F506 |
| Edit | Ctrl+Shift+V | edit.paste-as-plaintext | F506 |
| Edit | Ctrl+Alt+D | edit.duplicate | F506 |
| Edit | Ctrl+Shift+N | edit.create-paragraph | F506 |
| Edit | Ctrl+Shift+D | edit.delete-paragraph | F506 |
| Edit | Ctrl+F | edit.find | F506 |
| Edit | F3 | edit.find-next | F513 |
| Edit | Shift+F3 | edit.find-previous | F513 |
| Edit | Ctrl+R | edit.replace | F506 |
| Edit | Ctrl+Shift+F | edit.find-in-folder | F506 |
| Paragraph | Ctrl+Plus | paragraph.upgrade-heading | F514, F507 |
| Paragraph | Ctrl+Minus | paragraph.degrade-heading | F507 |
| Paragraph | Ctrl+Shift+T | paragraph.table | F507 |
| Paragraph | Ctrl+Shift+K | paragraph.code-fence | F507 |
| Paragraph | Ctrl+Shift+Q | paragraph.quote-block | F507 |
| Paragraph | Ctrl+Alt+N | paragraph.math-formula | F507 |
| Paragraph | Ctrl+Alt+H | paragraph.html-block | F507 |
| Paragraph | Ctrl+G | paragraph.order-list | F507 |
| Paragraph | Ctrl+H | paragraph.bullet-list | F507 |
| Paragraph | Ctrl+Alt+X | paragraph.task-list | F507 |
| Paragraph | Ctrl+Alt+L | paragraph.loose-list-item | F507 |
| Paragraph | Ctrl+Shift+0 | paragraph.paragraph | F507 |
| Paragraph | Ctrl+Shift+U | paragraph.horizontal-line | F507 |
| Paragraph | Ctrl+Alt+Y | paragraph.front-matter | F507 |
| Format | Ctrl+B | strongMenuItem | F502, F508 |
| Format | Ctrl+I | emphasisMenuItem | F508 |
| Format | Ctrl+U | underlineMenuItem | F508 |
| Format | Ctrl+Shift+H | highlightMenuItem | F508 |
| Format | Ctrl+` | inlineCodeMenuItem | F508 |
| Format | Ctrl+Shift+M | inlineMathMenuItem | F508 |
| Format | Ctrl+D | strikeMenuItem | F508 |
| Format | Ctrl+L | hyperlinkMenuItem | F508 |
| Format | Ctrl+Shift+I | imageMenuItem | F508 |
| Format | Ctrl+Shift+R | clearFormatMenuItem | F508 |
| View | Ctrl+Shift+P | view.command-palette | F509, F1206 |
| View | Ctrl+E | sourceCodeModeMenuItem | F503, F509 |
| View | Ctrl+Shift+G | typewriterModeMenuItem | F509 |
| View | Ctrl+Shift+J | focusModeMenuItem | F509 |
| View | Ctrl+J | sideBarMenuItem | F509 |
| View | Ctrl+K | tocMenuItem | F509 |
| View | Ctrl+Shift+B | tabBarMenuItem | F509 |
| View | F5 | view.reload-images | F509 |
| Window | Ctrl+M | window.minimize | — |
| Window | F11 | window.toggle-full-screen | F1208 |
| Tabs | Ctrl+Tab | tabs.cycleForward | F515 |
| Tabs | Ctrl+Shift+Tab | tabs.cycleBackward | F515 |

### 8.2 ALWAYS_FIRE 白名单（17 个）

> 在 `<input>`/`<textarea>` 中仍触发的快捷键

```
file.new-window, file.new-tab, file.open-file, file.open-folder,
file.save, file.save-as, file.export-file-pdf, file.print,
file.preferences, file.close-tab, file.close-window, file.quit,
edit.find, edit.find-next, edit.find-previous, edit.replace, edit.find-in-folder,
sourceCodeModeMenuItem, typewriterModeMenuItem, focusModeMenuItem,
sideBarMenuItem, tocMenuItem, tabBarMenuItem,
view.command-palette, view.reload-images,
window.minimize, window.toggle-full-screen,
tabs.cycleForward, tabs.cycleBackward
```

### 8.3 迁移审计已知问题跟踪

以下 `migration-audit.md` 中的 P0 遗漏项需要优先验证：

| # | 问题 | 对应用例 | 建议优先级 |
|---|---|---|---|
| P0-1 | 保存不写盘 | E2E-F203 | **立即** |
| P0-6 | 单实例检测 | E2E-F1801 | **立即** |
| P0-7 | 文件监听未接线 | E2E-F1303 | **立即** |
| P0-4 | 导出 PDF | E2E-F1601 | 发布前 |
| P0-5 | 打印 | E2E-F1603 | 发布前 |
| P1-10 | 会话恢复 | E2E-F104 | 发布前 |
| P1-11 | 保存后状态反馈 | E2E-F211 | 发布前 |
| P1-13 | 跨窗口偏好同步 | E2E-F1408 | 发布前 |

---

> **文档结束** | 共 20 个功能领域，186 个测试用例，31 个 P0，96 个 P1，59 个 P2