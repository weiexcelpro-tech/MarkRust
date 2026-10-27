/**
 * STATIC 用例（B08-02 / B09-03）—— 读取源码/配置做不变量断言，可挂 CI。
 *
 * 结果语义（与本仓库 E2E 约定一致）：
 * - 断言失败 = bug 复现（有效结果），禁止为了让断言通过而修改应用源码/配置；
 * - 只有 mock-tauri.ts（测试基建）允许按任务要求补齐缺失命令。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// vitest 从项目根（MarkRust/）启动，process.cwd() 即仓库根
const ROOT = process.cwd()

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8')

// ─────────────────────────────────────────────────────────────
// TC-B08-02 配置一致性：decorations 与 titleBarStyle 二选一
// ─────────────────────────────────────────────────────────────
describe('TC-B08-02: tauri.conf.json decorations 与渲染层默认 titleBarStyle 互斥', () => {
  const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
    app: { windows: Array<{ label: string; decorations?: boolean }> }
  }
  const mainWindow = tauriConf.app.windows.find((w) => w.label === 'main')
  const decorations = mainWindow?.decorations

  // 渲染层默认偏好（store/preferences.ts 的 DEFAULT_PREFERENCES）
  const preferencesSrc = read('src/renderer/src/store/preferences.ts')
  const storeDefault = /titleBarStyle:\s*'(\w+)'/.exec(preferencesSrc)?.[1]

  // Rust 侧默认偏好文件（v1.1.x 存在 preferences-default.json）
  let rustDefault: string | undefined
  try {
    const prefDefault = JSON.parse(read('src-tauri/resources/preferences-default.json')) as {
      titleBarStyle?: string
    }
    rustDefault = prefDefault.titleBarStyle
  } catch {
    rustDefault = undefined
  }

  const effectiveDefault = storeDefault ?? rustDefault

  it('主窗口 decorations 字段存在且为 boolean（前置健全性）', () => {
    expect(typeof decorations).toBe('boolean')
  })

  it('互斥关系：titleBarStyle=custom ⇒ decorations:false（双按钮根因，当前应 FAIL=bug 复现）', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[B08-02 现状] decorations=${String(decorations)}, storeDefault=${String(storeDefault)}, rustDefault=${String(rustDefault)}`
    )
    if (effectiveDefault === 'custom') {
      expect(decorations, 'custom 标题栏与原生装饰互斥：decorations 必须为 false').toBe(false)
    }
  })

  it('Rust 动态创建窗口（settings/editor）的 decorations 参数与配置源一致', () => {
    const windowRs = read('src-tauri/src/commands/window.rs')
    // 修复形态：custom 模式下动态窗口必须显式 decorations(false)
    const hasDecorationsCall = /\.decorations\(\s*(true|false)\s*\)/.test(windowRs)
    // eslint-disable-next-line no-console
    console.log(`[B08-02 现状] window.rs 显式设置 decorations: ${hasDecorationsCall}`)
    if (effectiveDefault === 'custom') {
      expect(
        hasDecorationsCall,
        'custom 模式下 window.rs 动态开窗需显式 .decorations(false) 保持互斥'
      ).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// TC-B09-03 watcher 链路静态完整性
// ─────────────────────────────────────────────────────────────
describe('TC-B09-03: watcher 链路静态完整性（打开 → watch → 外部变更事件 → 响应）', () => {
  it('① mock-tauri.ts 的 MOCK_INVOKE_RESPONSES 注册 watch_file / unwatch_file（补 mock 前应 FAIL）', () => {
    const mockSrc = read('tests/e2e/mock-tauri.ts')
    // 仅统计 MOCK_INVOKE_RESPONSES 表内的注册（watch_file: <值> 形式）
    const hasWatch = /^\s*watch_file:\s*/m.test(mockSrc)
    const hasUnwatch = /^\s*unwatch_file:\s*/m.test(mockSrc)
    // eslint-disable-next-line no-console
    console.log(`[B09-03① 现状] watch_file 注册=${hasWatch}, unwatch_file 注册=${hasUnwatch}`)
    expect(hasWatch, 'MOCK_INVOKE_RESPONSES 缺少 watch_file（mock 下 watcher 链路断链）').toBe(true)
    expect(hasUnwatch, 'MOCK_INVOKE_RESPONSES 缺少 unwatch_file').toBe(true)
  })

  it('② 渲染层存在 mt::update-file 监听并接「刷新或提示」处理逻辑', () => {
    const editorStore = read('src/renderer/src/store/editor.ts')
    expect(editorStore).toContain("'mt::update-file'")
    expect(editorStore).toContain('LISTEN_FOR_FILE_CHANGE')
    // 处理逻辑：change → 通知/自动重载（loadChange / pushTabNotification）
    expect(editorStore).toContain('loadChange')
    expect(editorStore).toContain('pushTabNotification')

    // tauri-bridge 的监听桥与保存自反馈抑制（1.5s 同路径丢弃）
    const bridge = read('src/renderer/src/tauri-bridge.ts')
    expect(bridge).toContain("'mt::update-file'")
    expect(bridge).toContain('SAVED_PATH_SUPPRESS_MS')
  })

  it('③ 打开文件/目录时前端调用 watch_file 的代码链路存在', () => {
    const project = read('src/renderer/src/store/project.ts')
    expect(project).toContain("invoke('watch_file'")
    const bridge = read('src/renderer/src/tauri-bridge.ts')
    expect(bridge).toContain("invoke('unwatch_file'")

    // 已知现状（勘察结论，非断言）：watch_file 仅在打开「目录」时注册
    // （project.ts OPEN_PROJECT），单文件打开（mt::open-file / 拖入 / 链接跳转）
    // 从不调用 watch_file —— 单文件场景外部修改无感知的结构性根因之一。
    // eslint-disable-next-line no-console
    console.log(
      '[B09-03③ 现状] watch_file 唯一调用点为 OPEN_PROJECT（目录）；单文件打开无监听注册'
    )
  })
})
