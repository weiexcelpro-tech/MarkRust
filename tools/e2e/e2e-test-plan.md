# MarkRust E2E 测试计划

## 测试失败反思

### 为什么保存 bug 没被发现
之前 CDP 验证 `markdown_save` 时直接构造了：
```js
{ encoding: 'utf-8', lineEnding: 'lf', ... }  // ← 硬编码 string
```
但真实路径是 `editor.ts FILE_SAVE() → getOptionsFromState(currentFile)` 返回：
```js
{ encoding: { encoding: 'utf8', isBom: false }, ... }  // ← 对象！
```
**绕过了 editor store，用假数据测试，必然漏掉类型不匹配 bug。**

### E2E 测试核心原则
1. **走真实 UI 路径**：模拟用户操作（CDP Input.dispatchKeyEvent/MouseEvent），不直接调 invoke/IPC
2. **用真实 store 数据**：从 editor store 获取参数验证，不硬编码
3. **验证端到端**：操作 → UI 变化 → 文件系统 → 读回对比
4. **覆盖边界**：CRLF、大文件、空文件、特殊字符、多标签

## 测试架构

```
tools/e2e/
├── setup.mjs           # CDP 连接 + 应用启动 + 公共工具
├── run-all.mjs         # 测试运行器（按优先级执行 + 汇总报告）
├── T001-startup.mjs    # P0: 应用启动
├── T002-open-file.mjs  # P0: 打开文件（真实 DOM 点击）
├── T003-save-file.mjs  # P0: 保存文件（Ctrl+S → 文件系统验证）
├── T004-render.mjs     # P0: markdown 渲染（computed style 检查）
├── T005-ctrl-e.mjs     # P0: Ctrl+E 源码/渲染切换
├── T006-open-folder.mjs # P1: 打开文件夹（文件树递归）
├── T007-crlf.mjs       # P1: CRLF 文件渲染
├── T008-tab-name.mjs   # P1: 标签名显示文件名
├── T009-save-as.mjs    # P1: 另存为
├── T010-multi-tab.mjs  # P1: 多标签切换
├── T011-shortcuts.mjs  # P1: 快捷键 Ctrl+B/I/U/K/J
├── T012-single-instance.mjs # P1: 单实例检测
├── T013-argv.mjs       # P1: 命令行参数打开文件
├── T014-watcher.mjs    # P1: 文件监听
├── T015-css-loaded.mjs # P2: muya CSS 加载
├── T016-mu-editor.mjs  # P2: .mu-editor 类名存在
├── T017-encoding.mjs   # P2: encoding 参数类型（string 非 map）
└── README.md           # 使用说明
```

## 测试用例清单

### P0 冒烟测试（每次构建必须全通过）

#### T001: 应用启动
- **前置**：markrust.exe 不在运行
- **步骤**：启动 markrust.exe → 等待 3s
- **验证**：进程存活 + 窗口标题含 "MarkRust" + DOM 有 #app + pinia store 可访问
- **CDP 检查**：`document.querySelector('#app')` 非空 + `document.querySelector('#app').__vue_app__` 非空

#### T002: 打开文件（真实 DOM 点击）
- **前置**：应用已启动 + 有测试文件夹（含 .md 文件）
- **步骤**：
  1. Sidebar → Open Folder → 选测试文件夹（CDP 模拟 OPEN_PROJECT）
  2. 等待文件树渲染
  3. **真实 DOM 点击**第一个 .md 文件（CDP Input.dispatchMouseEvent，不是 IPC）
  4. 等待 2s
- **验证**：
  - editor store currentFile 非空
  - currentFile.pathname 包含测试文件路径
  - currentFile.markdown 长度 > 0
  - DOM 有 .mu-container 子节点 > 0
  - **currentFile.filename 不等于 "Untitled-1"**（回归 T008）
- **关键**：必须走真实点击路径，不能直接 `ipcRenderer.send('mt::open-file')`

#### T003: 保存文件（最关键）
- **前置**：T002 通过（文件已打开）
- **步骤**：
  1. 记录当前文件路径和原始内容
  2. 在编辑器中修改内容（CDP 在 .mu-editor 内输入文字）
  3. **按 Ctrl+S**（CDP Input.dispatchKeyEvent，不是 IPC）
  4. 等待 2s
  5. 从磁盘读取文件内容（Node fs.readFile）
- **验证**：
  - 文件内容包含修改的文字
  - editor store currentFile.isSaved === true
  - **encoding 参数类型正确**（不报错 = Rust 收到 string 非 map）
- **关键**：必须走 Ctrl+S → keyboardShortcut → handleMenuClick → tauri-bridge save handler → invoke('markdown_save') 完整链路。这样能发现 encoding 是对象导致的类型错误。
- **边界用例**：
  - T003a: LF 文件保存（lineEnding='lf'）
  - T003b: CRLF 文件保存（adjustLineEndingOnSave=true）
  - T003c: 空文件保存（markdown=''）
  - T003d: 含特殊字符保存（emoji、中文、表格）

#### T004: markdown 渲染
- **前置**：T002 通过
- **步骤**：打开含各种 markdown 语法的测试文件（标题/表格/列表/代码块/引用）
- **验证**：
  - DOM 有 `.mu-atx-heading`（标题被识别）
  - DOM 有 `.mu-table`（表格被识别）
  - DOM 有 `.mu-bullet-list` 或 `.mu-order-list`（列表被识别）
  - DOM 有 `.mu-code-block`（代码块被识别）
  - H1 的 computed fontSize >= 24px（CSS 加载）
  - 段落的 computed color 不是默认黑色（CSS 加载）

#### T005: Ctrl+E 源码/渲染切换
- **前置**：T002 通过
- **步骤**：
  1. 记录 sourceCode 当前值
  2. 在编辑器内 focus（CDP 点击 .mu-editor）
  3. 按 Ctrl+E（CDP Input.dispatchKeyEvent）
  4. 等待 500ms
- **验证**：
  - sourceCode 翻转（before ≠ after）
  - DOM 出现/消失 source-code 组件
  - 再按 Ctrl+E 应回到原状态

### P1 功能测试

#### T006: 打开文件夹
- **步骤**：OPEN_PROJECT → 等待文件树
- **验证**：
  - projectTree.folders.length + files.length > 0
  - 子目录递归展示（folders 非空时有子 folders/files）
  - .md 文件 isMarkdown === true
  - .txt 文件 isMarkdown === true
  - 非文本文件 isMarkdown === false

#### T007: CRLF 文件渲染
- **步骤**：打开已知 CRLF 行尾的 .md 文件
- **验证**：
  - DOM 有 `.mu-atx-heading`（不是全 mu-paragraph）
  - DOM 有 `.mu-table`（如果有表格）
  - muya 块类型不是全 mu-paragraph

#### T008: 标签名显示文件名
- **步骤**：T002 后检查
- **验证**：
  - currentFile.filename === 真实文件名（如 "README.md"）
  - currentFile.filename !== "Untitled-1"
  - DOM 标签栏显示真实文件名

#### T009: 另存为
- **步骤**：
  1. 修改内容
  2. Ctrl+Shift+S（或菜单 Save As）
  3. 在对话框选新路径（CDP 模拟或直接调 dialog_save_file）
  4. 验证新文件写入
- **验证**：
  - 新路径文件存在
  - 内容匹配
  - currentFile.pathname 更新为新路径
  - currentFile.filename 更新

#### T010: 多标签切换
- **步骤**：
  1. 打开文件 A
  2. 打开文件 B（新标签）
  3. 点击标签 A
  4. 点击标签 B
- **验证**：
  - 切换后 currentFile.pathname 变化
  - muya 内容更新
  - 两个标签的修改都保留

#### T011: 快捷键
- **步骤**：在编辑器内 focus → 逐个按快捷键
- **验证**：
  - Ctrl+B: 格式变化（bold）
  - Ctrl+I: 格式变化（italic）
  - Ctrl+U: 格式变化（underline）
  - Ctrl+K: rightColumn 变化（TOC）
  - Ctrl+J: showSideBar 变化
  - Ctrl+Shift+B: showTabBar 变化
  - Ctrl+Shift+G: typewriter 变化
  - Ctrl+Shift+J: focus 变化

#### T012: 单实例检测
- **前置**：应用已运行
- **步骤**：启动第二个 markrust.exe 进程（带 .md 参数）
- **验证**：
  - 第二个进程自动退出
  - 第一个窗口收到文件打开事件
  - 文件在新标签打开
  - 进程数仍为 1

#### T013: 命令行参数打开文件
- **步骤**：`markrust.exe "path/to/file.md"` 启动
- **验证**：
  - 应用启动后自动打开该文件
  - currentFile.pathname === 传入路径

#### T014: watcher 文件监听
- **前置**：已打开文件夹
- **步骤**：
  1. 在外部创建新 .md 文件（Node fs.writeFile）
  2. 等待 2s（watcher debounce）
- **验证**：
  - projectTree 出现新文件
  - editor store 收到 mt::update-file 或 mt::update-object-tree 事件

### P2 回归测试（之前修复的 bug）

#### T015: muya CSS 加载
- **验证**：`document.querySelectorAll('style').length` > 0 或 computed style 非默认

#### T016: .mu-editor 类名存在
- **验证**：`document.querySelector('.mu-editor')` 非空

#### T017: encoding 参数类型
- **步骤**：T003 保存时检查
- **验证**：保存不报错 = encoding 是 string（非 map）

#### T018: filename 字段完整
- **验证**：T002 打开文件后 currentFile.filename 非空且非 "Untitled-1"

#### T019: export-pdf ID 匹配
- **步骤**：Ctrl+Alt+E
- **验证**：不报错（findCommand 能找到 file.export-file-pdf）

#### T020: 文件关联
- **步骤**：检查注册表 HKCU\Software\Classes\.md → MarkRust.md
- **验证**：ProgId 正确 + command 指向当前 exe

## 自动化实现指南

### CDP 连接模板
```js
// setup.mjs
const CDP_BASE = 'http://127.0.0.1:9222';
async function connect() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  const target = (await res.json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { ws, evaluate, cdp, screenshot };
}
```

### 真实按键模拟（关键！）
```js
// 必须用 Input.dispatchKeyEvent，不能直接调 ipcRenderer.send
async function pressKey(ws, key, modifiers = []) {
  const code = key.toUpperCase().charCodeAt(0);
  await cdp(ws, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key, code,
    windowsVirtualKeyCode: code,
    modifiers: modifiers.includes('ctrl') ? 2 : 0
  });
  await cdp(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, code,
    windowsVirtualKeyCode: code,
    modifiers: modifiers.includes('ctrl') ? 2 : 0
  });
}
```

### 真实点击模拟
```js
// 必须用 Input.dispatchMouseEvent，不能直接调 ipcRenderer.send
async function clickElement(ws, selector) {
  const rect = await evaluate(ws, `(() => {
    const el = document.querySelector('${selector}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`);
  const { x, y } = JSON.parse(rect);
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
```

### store 访问
```js
async function getStore(ws, storeId) {
  return JSON.parse(await evaluate(ws, `(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === '${storeId}');
    return JSON.stringify(store ? { ...store.$state } : null);
  })()`));
}
```

### 文件系统验证
```js
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
// 保存后读回验证
const diskContent = readFileSync(path, 'utf-8');
assert(diskContent.includes(modifiedText), 'File content mismatch');
```

## 测试运行流程
```bash
# 1. 构建应用
cd marktext-tauri && npx vite build
cd src-tauri && cargo build --release --features tauri/custom-protocol
cp target/release/markrust.exe target/release/markrust-1.0.X.exe

# 2. 启动带 CDP 的应用
powershell -ExecutionPolicy Bypass -File tools/verify/start-with-cdp.ps1

# 3. 运行测试
node tools/e2e/run-all.mjs

# 4. 检查结果（exit code 0 = 全通过）
echo $?
```
