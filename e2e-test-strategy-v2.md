---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '6461cb4f-dff8-45ca-927f-ff0149c52b3d'
  PropagateID: '6461cb4f-dff8-45ca-927f-ff0149c52b3d'
  ReservedCode1: 'cfaf8ede-04f6-4f8c-b62c-f64bd1ce54c8'
  ReservedCode2: 'cfaf8ede-04f6-4f8c-b62c-f64bd1ce54c8'
---

# MarkRust E2E 测试策略 v2

> 版本：2.0 | 日期：2026-07-17
> 定位：替换 v1 策略中导致"90.1% 假阳性通过率"的系统性设计缺陷

---

## 一、v1 策略的问题诊断

### 1.1 一个典型案例

**现象**：Window 菜单的三个功能（最小化、置顶、全屏）在真实运行中点击无反应。
**v1 测试结果**：菜单测试全部 PASS，通过率 90.1%。
**根因**：测试从未真正验证这三个功能。

### 1.2 五个系统性设计缺陷

| # | 缺陷 | 表现 | 后果 |
|---|------|------|------|
| D1 | **Mock 绕过真实事件系统** | `run-menu.cjs` 用 `__E2E_EMIT__('mt::menu::click')` 直接触发前端 handler，跳过 Rust 菜单事件 → Tauri emit → 前端 listen 的完整链路 | Rust 侧断线无法被发现 |
| D2 | **断言硬编码为 true** | `run-menu.cjs` 中 11 处 `check('xxx', true)`，只验证"不崩溃" | 功能失效被报告为 PASS |
| D3 | **Mock invoke 返回预设值** | `__TAURI_INTERNALS__.invoke` 被 mock 成查表返回，所有 Rust command 返回 `null`/预设值 | Rust 权限缺失、command 未注册、参数不匹配全部不可见 |
| D4 | **测试分层错位** | F609（Window 菜单完整）标记为 T1（Mock E2E），不进 T3（CDP E2E）；Gate 1 被直接跳过 | 基础功能验证缺失 |
| D5 | **核心原则被自身违背** | 策略文档第一条原则说"走真实 UI 路径，不直接调 invoke/IPC"，但测试模板第一步就是 `ipcRenderer.send('mt::open-file')` | 文档与实现脱节 |

### 1.3 "90.1% 通过率"的真相

```
v1 通过率 = 前端逻辑路径正确率（在 Mock 环境中）
          ≠ 真实功能可用率

实测：真实功能可用率远低于 90.1%
     窗口菜单 3/3 失效、多个 IPC 通道断线、权限缺失
     → 这些全部被 v1 报告为 PASS
```

---

## 二、核心设计原则

### 原则 1：测试必须验证可观察的副作用

```
禁止：check('名称', true)           // 只验证"不崩溃"
禁止：check('名称', 不抛异常)        // 只验证"不报错"
要求：check('名称', 副作用发生)      // 验证功能真正生效
```

副作用的可观察形式：
- **窗口状态**：`getCurrentWindow().isMinimized()` 返回 true
- **文件系统**：磁盘文件内容包含预期文本
- **DOM 变化**：`.mu-source-code` 类出现/消失
- **Store 状态**：Pinia store 中 `sourceCode === true`
- **事件触发**：监听到 `mt::tab-saved` 事件

### 原则 2：分层隔离，每层只断言自己能验证的事

| 层级 | 能验证 | 不能验证 |
|------|--------|----------|
| L1 Mock E2E | 前端逻辑完整性、DOM 响应、状态流转 | Rust 命令可执行性、权限链、真实文件 IO |
| L3 全链路集成 | 每个 Rust command 的真实可调用性、权限链 | UI 交互路径完整性 |
| L4 UI 驱动 E2E | 用户操作 → 真实功能生效的全链路 | — |

**L1 通过 ≠ 功能可用**。L1 的 PASS 只代表"前端逻辑正确"，必须在 L3/L4 也通过才能宣布功能可用。

### 原则 3：命令必先巡检，再测 UI 路径

先通过 L3 巡检确认每条 Rust command 的全链路连通性（权限 → 注册 → 参数 → 返回值），再做 L4 UI 驱动测试。
**就像先通水再测龙头**——如果管道是断的，测龙头开关没有任何意义。

---

## 三、新分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│  L0  单元测试 (Vitest)                                           │
│  位置: tests/unit/                                速度: 秒级      │
│  验证: 函数级正确性（快捷键映射、命令分发、IPC参数）              │
│  断言: 函数返回值 / mock 调用次数                                 │
├──────────────────────────────────────────────────────────────────┤
│  L1  前端集成测试 (Playwright + mock-tauri)                      │
│  位置: tests/e2e/*.spec.ts                        速度: 分钟级    │
│  验证: 前端 UI 交互、渲染、状态流转（无 Rust 后端）              │
│  断言: DOM 变化 / Store 状态 / 事件触发                          │
│  ⚠️ PASS 只代表前端逻辑正确，不代表功能可用                      │
├──────────────────────────────────────────────────────────────────┤
│  L2  契约测试 (Vitest)                                           │
│  位置: tests/contract/                            速度: 秒级      │
│  验证: 前端调用参数 ↔ Rust 命令签名一致性                        │
├──────────────────────────────────────────────────────────────────┤
│  L3  全链路命令巡检 (CDP → markrust.exe)            ← v2 新增    │
│  位置: tools/e2e/integration/                     速度: 分钟级    │
│  验证: 每个 Rust command 的真实可调用性                          │
│  断言: invoke 返回值 / 窗口状态 / 文件系统                       │
│  核心: 逐条直接 invoke Rust command，绕过前端                    │
├──────────────────────────────────────────────────────────────────┤
│  L4  UI 驱动 E2E (CDP → markrust.exe)               ← v2 改进    │
│  位置: tools/e2e/ui-driven/                       速度: 分钟级    │
│  验证: 用户操作路径 → 真实功能生效的全链路                      │
│  断言: 可观察副作用（窗口/文件/DOM/Store）                       │
│  核心: 真实 markrust.exe + CDP 键盘/鼠标输入                    │
├──────────────────────────────────────────────────────────────────┤
│  L5  回归验证 (tools/verify/)                                    │
│  位置: tools/verify/                              速度: 秒~分钟级 │
│  验证: 已修复 bug 的回归守护                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 与 v1 的关键差异

| 维度 | v1 | v2 |
|------|----|----|
| 分层数 | 5 层（T0-T4） | 6 层（L0-L5） |
| CDP 测试 | 单一 T3 层，混合 Mock 与真实 | 拆分为 L3（命令巡检）+ L4（UI 驱动），职责清晰 |
| Mock E2E | 被当作功能验证 | 明确标注"仅验证前端逻辑" |
| 断言标准 | 允许 `check(true)` | 强制三级断言标准（见下节） |
| 命令连通性 | 从未系统检查 | L3 专项巡检 |

---

## 四、断言标准规范

### 4.1 三级断言标准

| 级别 | 名称 | 定义 | 示例 |
|------|------|------|------|
| **A级** | 副作用断言 | 验证功能产生的可观察副作用 | 最小化后 `isMinimized()===true`；保存后磁盘文件包含新内容 |
| **B级** | 返回值断言 | 验证 API 返回值符合预期 | `invoke('window_is_maximized')` 返回 boolean |
| **C级** | 存活断言 | 验证操作不导致崩溃 | 仅作为 A/B 级的补充检查，**不可单独使用** |

**规则**：每个测试用例至少包含一个 A 级或 B 级断言。C 级断言不可作为唯一断言。

### 4.2 禁止模式

```javascript
// ❌ 禁止：硬编码 true
check('View→Sidebar toggle', true)

// ❌ 禁止：只验证不崩溃
check('Format→Strong', !crashed)

// ✅ 正确：验证 Store 状态变化
const before = await getStore(ws, 'layout')
await emitMenu('sideBarMenuItem')
const after = await getStore(ws, 'layout')
check('View→Sidebar toggle', before.showSideBar !== after.showSideBar)

// ✅ 正确：验证窗口状态
await emitMenu('window.toggle-full-screen')
await sleep(500)
const isFull = await evaluate(ws, `getCurrentWindow().isFullscreen()`)
check('Window→Full Screen', isFull === true)
```

### 4.3 L3 巡检断言模板

```javascript
// L3 巡检：直接 invoke Rust command，验证真实可调用性
// 不经过前端 commands/index.ts，直接从 CDP Runtime.evaluate 调 invoke

// 1. 权限检查
const permResult = await evaluate(ws, `
  (async () => {
    try {
      await invoke('window_toggle_always_on_top', { label: 'main' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.toString() };
    }
  })()
`)
check('window_toggle_always_on_top 权限+注册', permResult.ok)
// A级：如果命令改变窗口状态，验证 isAlwaysOnTop()
if (permResult.ok) {
  const isOnTop = await evaluate(ws, `getCurrentWindow().isAlwaysOnTop()`)
  check('window_toggle_always_on_top 效果', typeof isOnTop === 'boolean')
}

// 2. 参数签名检查
const paramResult = await evaluate(ws, `
  (async () => {
    try {
      // 故意传错参数类型
      await invoke('markdown_save', { state: 'wrong-type' });
      return { ok: false, error: 'should reject wrong type' };
    } catch (e) {
      return { ok: true, error: e.toString() }; // 正确拒绝
    }
  })()
`)
check('markdown_save 参数校验', paramResult.ok)
```

---

## 五、L3 全链路命令巡检（核心新增）

### 5.1 巡检目标

逐一验证每个 Rust command 的：
1. **注册状态**：是否在 `generate_handler!` 中注册
2. **权限链**：capabilities/default.json 是否授权
3. **参数匹配**：前端传参类型与 Rust 签名是否匹配
4. **执行结果**：invoke 是否正常返回
5. **副作用**：命令执行后的可观察变化

### 5.2 命令清单与巡检矩阵

基于 `lib.rs` 的 65 个注册命令和前端调研结果：

#### P0 — 核心命令（必须100%通过）

| Rust Command | 前端入口 | 调用路径 | 巡检方式 | 预期副作用 |
|-------------|---------|---------|---------|-----------|
| `window_new_editor` | `file.new-window` | ipcRenderer.send → invoke | 执行后窗口数+1 | 新窗口出现 |
| `window_close` | `file.close-window` / `file.quit` | ipcRenderer.send → invoke | 执行后窗口数-1 | 窗口消失 |
| `window_toggle_always_on_top` | `window.toggle-always-on-top` | ipcRenderer.send → invoke | 执行后 isAlwaysOnTop 翻转 | 窗口层级变化 |
| `window_is_maximized` | 标题栏最大化按钮 | invoke | 返回 boolean | 无副作用 |
| `markdown_save` | `file.save` / `file.save-as` | bus.emit→ipcRenderer.send→invoke | 磁盘文件更新 | 文件内容变化 |
| `dialog_open_file` | `file.open-file` | ipcRenderer.send → invoke | 返回文件路径或 null | — |
| `dialog_open_directory` | `file.open-folder` | ipcRenderer.send → invoke | 返回目录路径或 null | — |
| `dialog_save_file` | `file.save-as` / `file.export` | ipcRenderer.send → invoke | 返回保存路径或 null | — |
| `fs_read_markdown` | `file.open-file` | ipcRenderer.send → invoke | 返回文件内容和元信息 | — |
| `fs_write_file` | `file.export` | ipcRenderer.send → invoke | 磁盘文件创建 | 文件存在 |
| `fs_move` | `file.rename` / `file.move` | ipcRenderer.send → invoke | 文件路径变化 | 旧路径消失，新路径出现 |
| `preferences_get_all` | 启动 / `file.preferences` | invoke | 返回 50+ 项偏好对象 | — |
| `preferences_set` | 各种偏好修改 | ipcRenderer.send → invoke | 返回 true | 配置文件更新 |
| `i18n_load` | 语言切换 | invoke | 返回翻译对象 | — |

#### P0 — Tauri Window API（绕过 Rust command）

| API | 前端入口 | 权限需求 | 巡检方式 | 预期副作用 |
|-----|---------|---------|---------|-----------|
| `getCurrentWindow().minimize()` | `window.minimize` | `core:window:allow-minimize` | 执行后 isMinimized()===true | 窗口最小化 |
| `getCurrentWindow().setFullscreen(!isFull)` | `window.toggle-full-screen` | `core:window:allow-set-fullscreen` | 执行后 isFullscreen()翻转 | 全屏切换 |
| `getCurrentWindow().toggleMaximize()` | 标题栏 | `core:window:allow-maximize` + `allow-unmaximize` | 执行后 isMaximized()翻转 | 窗口最大化/还原 |
| `getCurrentWindow().close()` | `file.close-window` (路径①) | `core:window:allow-close` | 窗口关闭 | — |

#### P1 — 辅助命令

| Rust Command | 前端入口 | 巡检方式 | 预期副作用 |
|-------------|---------|---------|-----------|
| `unwatch_file` | `file.close-tab`（条件） | invoke 后无 watcher 事件 | — |
| `recent_add` | `file.open-file` | invoke 后 recent 列表更新 | — |
| `menu_set_checked` | `view.toggle-sidebar` 等 | invoke 后菜单 checked 状态变化 | — |
| `menu_set_enabled` | 选中文字状态变化 | invoke 后菜单 enabled 状态变化 | — |
| `shell_open_external` | `docs.user-guide` | invoke 后浏览器打开 URL | — |
| `shell_open_path` | 文件树右键 | invoke 后资源管理器打开 | — |
| `clipboard_write_text` | 复制 | invoke 后系统剪贴板更新 | 剪贴板内容变化 |
| `clipboard_read_text` | 粘贴 | 返回剪贴板文本 | — |

#### 已知断线/风险命令

| 命令/通道 | 风险 | L3 巡检预期 |
|----------|------|------------|
| `getCurrentWindow().minimize()` | capabilities 缺 `allow-minimize` | **FAIL**：权限不足 |
| `getCurrentWindow().setFullscreen()` | capabilities 缺 `allow-set-fullscreen` | **FAIL**：权限不足 |
| `window_open_settings` | 前端无入口调用 | 跳过（ Rust 命令注册但无调用方） |
| `updater_check_latest` | `isUpdatable` 硬编码 false | 跳过（命令被门控关闭） |
| `file.quit` → `window_close` | 语义弱化，只关当前窗口不退出 App | **WARN**：多窗口时行为不符合预期 |

### 5.3 L3 巡检脚本模板

```javascript
// tools/e2e/integration/L3-command-audit.mjs
import { connect, evaluate, sleep } from '../setup.mjs'

const ws = await connect()
const results = { pass: 0, fail: 0, warn: 0, skip: 0, details: [] }

async function audit(name, fn) {
  try {
    const r = await fn()
    results.details.push(`  ${r.ok ? 'PASS' : 'FAIL'} ${name}`)
    r.ok ? results.pass++ : results.fail++
    if (r.detail) results.details.push(`       → ${r.detail}`)
  } catch (e) {
    results.details.push(`  FAIL ${name}: ${e.message}`)
    results.fail++
  }
}

// ═══ Rust Command 巡检 ═══

// 1. window_toggle_always_on_top
await audit('window_toggle_always_on_top', async () => {
  const r = await evaluate(ws, `(async () => {
    try {
      await invoke('window_toggle_always_on_top', { label: 'main' });
      return { ok: true };
    } catch (e) { return { ok: false, detail: e.toString() }; }
  })()`)
  return r
})

// 2. window_is_maximized
await audit('window_is_maximized', async () => {
  const r = await evaluate(ws, `(async () => {
    try {
      const v = await invoke('window_is_maximized', { label: 'main' });
      return { ok: typeof v === 'boolean', detail: 'returns ' + typeof v };
    } catch (e) { return { ok: false, detail: e.toString() }; }
  })()`)
  return r
})

// 3. preferences_get_all
await audit('preferences_get_all', async () => {
  const r = await evaluate(ws, `(async () => {
    try {
      const v = await invoke('preferences_get_all');
      return { ok: v && typeof v === 'object' && Object.keys(v).length > 10,
               detail: Object.keys(v).length + ' keys' };
    } catch (e) { return { ok: false, detail: e.toString() }; }
  })()`)
  return r
})

// ═══ Tauri Window API 巡检（绕过 Rust）═══

// 4. minimize（预测会因权限缺失 FAIL）
await audit('getCurrentWindow().minimize()', async () => {
  const r = await evaluate(ws, `(async () => {
    try {
      await getCurrentWindow().minimize();
      await new Promise(r => setTimeout(r, 500));
      // minimize 后窗口隐藏，CDP 可能断连，所以这里只验证不抛异常
      return { ok: true, detail: 'no exception' };
    } catch (e) { return { ok: false, detail: e.toString() }; }
  })()`)
  return r
})

// 5. setFullscreen（预测会因权限缺失 FAIL）
await audit('getCurrentWindow().setFullscreen(true)', async () => {
  const r = await evaluate(ws, `(async () => {
    try {
      await getCurrentWindow().setFullscreen(true);
      const isFull = await getCurrentWindow().isFullscreen();
      await getCurrentWindow().setFullscreen(false); // 还原
      return { ok: isFull === true, detail: 'isFullscreen=' + isFull };
    } catch (e) { return { ok: false, detail: e.toString() }; }
  })()`)
  return r
})

// ... 继续巡检所有 65 个 command ...

console.log('\n=== L3 全链路命令巡检报告 ===')
for (const d of results.details) console.log(d)
console.log(`\n总计: ${results.pass} PASS, ${results.fail} FAIL, ${results.warn} WARN`)
process.exit(results.fail > 0 ? 1 : 0)
```

---

## 六、L4 UI 驱动 E2E（改进）

### 6.1 与 v1 的区别

| 维度 | v1 | v2 |
|------|----|----|
| 启动方式 | Vite dev server + mock-tauri | 真实 markrust.exe + CDP |
| 菜单触发 | `__E2E_EMIT__` 直接 emit | CDP 暴露的 `invoke('menu_click')` 或 Tauri menu API |
| invoke | Mock 返回预设值 | 真实 Rust command 执行 |
| 断言 | 硬编码 true | A/B 级断言验证副作用 |
| 报告含义 | "前端逻辑正确" | "功能真正可用" |

### 6.2 菜单专项测试（F6 重新设计）

> **背景**：v1 的 F6 把 Window 菜单标记为 T1（Mock E2E），导致三个窗口功能从未在真实环境中验证。

#### F6-L4 菜单全链路测试（必须 L3 通过后才执行）

| ID | 菜单项 | 操作方式 | A级断言 | 优先级 |
|----|--------|---------|---------|--------|
| F6-L4-01 | Window → Minimize | CDP 触发 `mt::menu::click { id: 'window.minimize' }` | `getCurrentWindow().isMinimized() === true` | P0 |
| F6-L4-02 | Window → Toggle Always on Top | 同上，id: `window.toggle-always-on-top` | `getCurrentWindow().isAlwaysOnTop()` 翻转 | P0 |
| F6-L4-03 | Window → Toggle Full Screen | 同上，id: `window.toggle-full-screen` | `getCurrentWindow().isFullscreen()` 翻转 | P0 |
| F6-L4-04 | File → New Window | id: `file.new-window` | 窗口数量 +1（通过 Tauri API 枚举所有窗口） | P0 |
| F6-L4-05 | File → Close Window | id: `file.close-window` | 窗口数量 -1 或进程退出 | P0 |
| F6-L4-06 | File → Preferences | id: `file.preferences` | layout store `showSideBar === true` 且 settings 面板可见 | P1 |
| F6-L4-07 | View → Source Code | id: `sourceCodeMenuItem` | layout store `sourceCode === true` + DOM 出现 source-code 组件 | P1 |
| F6-L4-08 | View → Sidebar | id: `sideBarMenuItem` | layout store `showSideBar` 翻转 + DOM 侧边栏显隐 | P1 |
| F6-L4-09 | View → Typewriter | id: `typewriterMenuItem` | layout store `typewriter` 翻转 | P1 |
| F6-L4-10 | View → Focus Mode | id: `focusMenuItem` | layout store `focus` 翻转 | P1 |
| F6-L4-11 | View → Tab Bar | id: `tabBarMenuItem` | layout store `showTabBar` 翻转 | P1 |
| F6-L4-12 | Format → Strong | 选中文字后 id: `strongMenuItem` | DOM 出现 `.mu-strong` | P1 |
| F6-L4-13 | Format → Emphasis | 选中文字后 id: `emphasisMenuItem` | DOM 出现 `.mu-em` | P1 |
| F6-L4-14 | CheckMenuItem 状态同步 | 点击 View → Sidebar | `invoke('menu_set_checked')` 被调用 + 菜单 checked 翻转 | P1 |

#### 菜单触发方式的实现

CDP 无法直接操作原生菜单栏（Tauri 原生菜单不在 WebView DOM 中）。两种方案：

**方案 A（推荐）：通过 Tauri menu API 直接触发**

```javascript
// Tauri 2 的 menu 事件是通过 Rust emit 给前端的
// 可以通过 CDP 直接调用前端的 menuBridge 来模拟
// 但这比 __E2E_EMIT__ 走得更远：要验证前端 → execute → Tauri API 的完整链路

// 实际做法：CDP 调用前端的 handleMenuClick，让它走完整的 execute() 路径
await evaluate(ws, `
  window.menuBridge && window.menuBridge.handleMenuClick('window.minimize')
`)
await sleep(500)
// 然后验证真实窗口状态
const isMin = await evaluate(ws, `getCurrentWindow().isMinimized()`)
check('F6-L4-01 Window→Minimize', isMin === true)
```

**方案 B（补充）：直接 invoke Rust 的菜单事件**

```javascript
// 从 Rust 侧直接触发菜单事件（绕过 UI）
// 这需要 Rust 侧暴露一个 test command 或利用 Tauri 的 menu API
await evaluate(ws, `
  invoke('test_trigger_menu', { id: 'window.minimize' })
`)
```

> 方案 A 能覆盖"前端命令 → Tauri API"这一段（v1 完全没覆盖的下半截），方案 B 能覆盖完整的"Rust 菜单事件 → 前端 → Tauri API"全链路。两者结合使用。

### 6.3 全部 L4 用例清单

> 在 v1 的 F1-F20 基础上，所有 T3 层用例改为 L4，并补充 A 级断言。以下仅列出与 v1 有变更或新增的部分。

#### F1 — 启动（同 v1，无变更）

#### F2 — 文件操作（补充 A 级断言）

| ID | 变更 | v1 断言 | v2 A级断言 |
|----|------|--------|-----------|
| F203 | 加严 | isSaved===true | isSaved===true **且磁盘文件内容包含新文本** |
| F204 | 加严 | 不报错 | **读回磁盘文件检查行尾为 \n** |
| F205 | 加严 | 不报错 | **读回磁盘文件检查行尾为 \r\n** |
| F206 | 加严 | 不报错 | **磁盘文件为空字符串** |

#### F6 — 菜单系统（全部改版，见 6.2 节）

#### F12 — 视图模式（补充分屏测试）

| ID | 新增 | 操作 | A级断言 |
|----|------|------|---------|
| F1208-L4 | **新增** | F11 全屏快捷键 | `getCurrentWindow().isFullscreen() === true` |
| F1209-L4 | **新增** | Ctrl+Shift+F 全屏（如有） | 同上 |

---

## 七、执行流程与门禁

### 7.1 CI 门禁设计

```
┌──────────────────────────────────────────────────────────┐
│ Gate 0: L0 单元测试           每次 commit, < 1min       │
│   通过标准: 100%                                          │
├──────────────────────────────────────────────────────────┤
│ Gate 1: L1 前端集成测试       每次 PR, < 5min            │
│   通过标准: 100%                                          │
│   ⚠️ PASS 只代表前端逻辑正确                              │
├──────────────────────────────────────────────────────────┤
│ Gate 2: L2 契约测试           每次 PR, < 1min            │
│   通过标准: 100%                                          │
├──────────────────────────────────────────────────────────┤
│ Gate 3: L3 全链路命令巡检     每次 PR, < 10min    ← 新增 │
│   通过标准: P0 命令 100% 通过                             │
│   ⚠️ 这是发现断线的核心关卡                               │
├──────────────────────────────────────────────────────────┤
│ Gate 4: L4 UI 驱动 E2E P0     每日构建 + 发布前, < 20min │
│   通过标准: P0 用例 100% 通过                             │
│   前置条件: Gate 3 已通过                                 │
├──────────────────────────────────────────────────────────┤
│ Gate 5: L4 UI 驱动 E2E 全量   发布前, < 60min            │
│   通过标准: ≥ 95% 通过                                    │
├──────────────────────────────────────────────────────────┤
│ Gate 6: L5 回归验证           发布前, < 15min            │
│   通过标准: 100%                                          │
└──────────────────────────────────────────────────────────┘
```

### 7.2 关键规则

1. **Gate 3 是 Gate 4 的前置条件**：如果 L3 命令巡检发现 P0 命令断线，直接跳过 L4 中的对应用例，报告为 BLOCKED（而非 FAIL），因为管道断了测龙头没意义。

2. **L1 PASS 不计入功能可用性**：测试报告必须区分：
   - ✅ 功能已验证可用（L4 PASS）
   - 🔶 前端逻辑正确，待集成验证（L1 PASS / L4 未执行）
   - ❌ 功能不可用（L4 FAIL 或 L3 FAIL）

3. **L3 巡检报告必须包含权限诊断**：当 Rust command 调用失败时，必须区分：
   - 权限缺失（capabilities/default.json 未授权）
   - 命令未注册（generate_handler! 遗漏）
   - 参数不匹配（snake_case/camelCase 不一致）
   - Rust 端逻辑错误（命令执行但返回错误）

### 7.3 测试报告模板

```markdown
=== MarkRust E2E Test Report v2 ===
Date: 2026-07-17
App: markrust.exe v1.0.X

Gate 0 (L0 Unit):       15/15  PASS ✓
Gate 1 (L1 Mock E2E):   42/42  PASS ✓  (前端逻辑正确性)
Gate 2 (L2 Contract):    8/8   PASS ✓
Gate 3 (L3 Cmd Audit):  58/65  PASS    5 FAIL, 2 SKIP    ← 断线清单
Gate 4 (L4 UI P0):      11/14  PASS    3 FAIL (3 BLOCKED)
Gate 5 (L4 UI All):     —      (未执行)
Gate 6 (L5 Regression): 21/21  PASS ✓

功能可用性判定: ❌ 不可发布
  原因: L3 发现 5 个 P0 命令断线

断线命令清单:
  ❌ getCurrentWindow().minimize()     — 权限缺失: core:window:allow-minimize
  ❌ getCurrentWindow().setFullscreen() — 权限缺失: core:window:allow-set-fullscreen
  ❌ window_new_editor                  — 参数不匹配: label 类型错误
  ❌ markdown_save                      — Rust 端 panic: 序列化错误
  ⚠️ file.quit                         — 语义弱化: 只关当前窗口不退出 App
```

---

## 八、与 v1 的迁移对照

### 8.1 v1 用例 → v2 层级映射

| v1 层级 | v2 层级 | 说明 |
|---------|---------|------|
| T0 单元 | L0 单元 | 无变化 |
| T1 Mock E2E | L1 前端集成 | 重命名，明确标注"仅验证前端逻辑" |
| T2 契约 | L2 契约 | 无变化 |
| T3 CDP E2E | L3 命令巡检 + L4 UI 驱动 | 拆分，T3 中混合的 Mock 和真实测试分离 |
| T4 回归 | L5 回归 | 无变化 |

### 8.2 v1 用例的处置策略

| v1 用例 | v2 处置 | 原因 |
|---------|---------|------|
| `run-menu.cjs` 全部 `check(true)` | 废弃，用 F6-L4 替代 | 断言无效 |
| `run-menu.cjs` 编辑器输入/撤销 | 迁移到 L1 `menu.spec.ts` | 前端逻辑测试 |
| F609 Window 菜单完整 (T1) | 改为 L4，新增 F6-L4-01~03 | 必须在真实环境验证 |
| F614 菜单点击不产生控制台错误 | 降级为 L1 的附加检查 | C级断言不可作为 L4 主体 |
| 所有 `__E2E_EMIT__` 调用 | 保留在 L1，L4 用 `menuBridge.handleMenuClick` | L1 验证事件分发，L4 验证全链路 |

### 8.3 新增工作量估算

| 新增项 | 数量 | 估算工时 |
|--------|------|---------|
| L3 命令巡检脚本 | 1 个脚本，65 条巡检 | 4h |
| L4 菜单全链路测试 | 14 条用例 | 6h |
| L4 窗口操作专项 | 3 条用例（minimize/fullscreen/always-on-top） | 3h |
| Gate 3 CI 集成 | 1 个门禁配置 | 2h |
| 权限修复验证 | 修复后回归测试 | 2h |
| **合计** | — | **~17h** |

---

## 九、已知问题与待验证项

### 9.1 已确认的断线/风险（需 L3 验证）

| # | 问题 | 影响 | 预期 L3 结果 |
|---|------|------|-------------|
| 1 | capabilities 缺 `core:window:allow-minimize` | window.minimize 失效 | FAIL |
| 2 | capabilities 缺 `core:window:allow-set-fullscreen` | window.toggle-full-screen 失效 | FAIL |
| 3 | `file.preferences` 不触达 Rust `window_open_settings` | 设置窗口作为独立窗口不启用 | SKIP |
| 4 | `file.quit` 和 `file.close-window` 都映射到 `window_close` | 多窗口时 Quit 不退出 App | WARN |
| 5 | `isUpdatable` 硬编码 false | `file.check-update` 命令永不出现 | SKIP |
| 6 | `mt::make-screenshot` 桥接 noop | 截图功能未实现 | SKIP |
| 7 | `file.export-file-pdf` 走 `window.print()` | 非 Rust PDF 导出，质量取决于 WebView | WARN |

### 9.2 L3 巡检后可能发现的更多问题

L3 巡检的目的是系统性发现断线，以上只是基于代码审查预估的已知风险。实际执行 L3 后可能会发现更多问题，特别是：
- camelCase/snake_case 参数命名不匹配（v1 报告中已有 11 个此类问题）
- Rust command 注册但权限未配置
- Rust command 权限配置但未注册
- 参数类型不匹配（string vs object）

---

## 十、实现优先级

### Phase 1（立即执行）：L3 命令巡检

1. 编写 `tools/e2e/integration/L3-command-audit.mjs`
2. 执行巡检，生成断线清单
3. 修复所有 P0 级断线（权限缺失、参数不匹配等）
4. 重新巡检，确保 P0 命令 100% 通过

### Phase 2：L4 菜单专项

1. 编写 `tools/e2e/ui-driven/F6-menu-fullchain.mjs`
2. 执行 14 条菜单全链路用例
3. 修复失效的菜单功能

### Phase 3：L4 全量补全

1. 将 v1 的 T3 用例迁移为 L4，补充 A 级断言
2. 补充窗口操作、文件操作等 A 级断言
3. L4 全量执行

### Phase 4：CI 集成

1. 配置 Gate 0-6 门禁
2. L3 作为 PR 必过门禁
3. 测试报告分级展示

---

## 附录 A：v1 run-menu.cjs 的问题标注

```javascript
// run-menu.cjs 中的 11 处硬编码 true：

第103行: check('View→Sidebar toggle 不崩溃', true)      // ❌ 应验证 showSideBar 翻转
第113行: check('View→Source Code Mode toggle', true)    // ❌ 应验证 sourceCode 翻转
第122行: check('View→Typewriter Mode toggle', true)     // ❌ 应验证 typewriter 翻转
第129行: check('View→Focus Mode toggle', true)           // ❌ 应验证 focus 翻转
第136行: check('View→Tab Bar toggle', true)              // ❌ 应验证 showTabBar 翻转
第150行: check('Format→Strong 不崩溃', true)             // ❌ 应验证 .mu-strong 出现
第154行: check('Format→Emphasis 不崩溃', true)           // ❌ 应验证 .mu-em 出现
第158行: check('Format→Inline Code 不崩溃', true)        // ❌ 应验证 .mu-inline-code 出现
第164行: check('File→New Tab 不崩溃', true)              // ❌ 应验证 markdownList.length +1
第168行: check('File→New Window 不崩溃', true)           // ❌ 应验证窗口数 +1

// 完全缺失：
// ❌ 没有 window.minimize 测试
// ❌ 没有 window.toggle-always-on-top 测试
// ❌ 没有 window.toggle-full-screen 测试
// ❌ 没有任何窗口操作的副作用验证

// Mock 注入（第36-57行）：
// __TAURI_INTERNALS__.invoke 被 mock 成查表返回
// 所有 Rust command 返回预设值，权限缺失和注册缺失完全不可见
```