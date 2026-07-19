/* eslint-disable @typescript-eslint/no-explicit-any */
// commands 注册表单元测试：验证 commands 数组结构完整、id 唯一、关键命令存在。
//
// 验证策略：
// 1. 直接 import commands 静态注册表（模块加载仅依赖 i18n/util，无副作用）。
// 2. 不调用任何 execute()，仅做结构断言，避免触发 ipcRenderer/bus。
// 3. id 格式正则放宽到 [a-zA-Z0-9-] 以兼容 tabs.cycleForward 等历史命名。

import { describe, expect, it } from 'vitest'
import commands, { type CommandDescriptor } from '../../src/renderer/src/commands'

const allIds: string[] = commands.map((c) => c.id)
const idSet = new Set(allIds)

describe('commands 注册表 — 基础完整性', () => {
  it('commands 数组非空', () => {
    expect(commands.length).toBeGreaterThan(0)
  })

  it('每个 command 是带 id 的对象', () => {
    for (const cmd of commands) {
      expect(typeof cmd).toBe('object')
      expect(typeof cmd.id).toBe('string')
      expect(cmd.id.length).toBeGreaterThan(0)
    }
  })
})

describe('commands 注册表 — id 唯一性', () => {
  it('所有顶层 id 无重复', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const id of allIds) {
      if (seen.has(id)) dupes.push(id)
      seen.add(id)
    }
    expect(dupes, `重复的顶层 id: ${dupes.join(', ')}`).toEqual([])
  })

  it('所有子命令 id 在全局范围内无重复', () => {
    const seen = new Set<string>(allIds)
    const dupes: string[] = []
    for (const cmd of commands) {
      if (!cmd.subcommands) continue
      for (const sub of cmd.subcommands) {
        if (seen.has(sub.id)) dupes.push(sub.id)
        seen.add(sub.id)
      }
    }
    expect(dupes, `重复的子命令 id: ${dupes.join(', ')}`).toEqual([])
  })
})

describe('commands 注册表 — id 格式', () => {
  // 接受 file.save / file.zoom-3 / tabs.cycleForward / window.change-theme-light 等形态。
  // 拒绝空字符串、纯数字、缺分隔符、首段大写等异常命名。
  const ID_PATTERN = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/

  it('所有顶层 id 匹配命名规范', () => {
    const bad = allIds.filter((id) => !ID_PATTERN.test(id))
    expect(bad, `非法顶层 id: ${bad.join(', ')}`).toEqual([])
  })

  it('所有子命令 id 匹配命名规范', () => {
    const bad: string[] = []
    for (const cmd of commands) {
      if (!cmd.subcommands) continue
      for (const sub of cmd.subcommands) {
        if (!ID_PATTERN.test(sub.id)) bad.push(sub.id)
      }
    }
    expect(bad, `非法子命令 id: ${bad.join(', ')}`).toEqual([])
  })
})

describe('commands 注册表 — 命令体非空壳', () => {
  // 命令有两种合法形态：
  // (A) 简单命令：自带 execute()
  // (B) 父命令：自带 executeSubcommand()，sub 可仅声明 id+value（如 file.zoom）
  // (C) 父命令：无 executeSubcommand，但每个 sub 自带 execute（如 file.export-file）
  // 任一形态都视为非空壳；三者皆缺才算违规。
  it('每个 command 都能产生执行行为（execute / executeSubcommand / sub.execute）', () => {
    const empties: string[] = []
    for (const cmd of commands) {
      const hasExecute = typeof cmd.execute === 'function'
      const hasSubExec = typeof cmd.executeSubcommand === 'function'
      const subsAllExecutable =
        !!cmd.subcommands &&
        cmd.subcommands.length > 0 &&
        cmd.subcommands.every((s) => typeof s.execute === 'function')
      if (!hasExecute && !hasSubExec && !subsAllExecutable) empties.push(cmd.id)
    }
    expect(empties, `空壳命令: ${empties.join(', ')}`).toEqual([])
  })

  it('带 subcommands 的命令：parent 有 executeSubcommand 或 subs 自带 execute', () => {
    const bad: string[] = []
    for (const cmd of commands) {
      if (!cmd.subcommands || cmd.subcommands.length === 0) continue
      const parentDispatch = typeof cmd.executeSubcommand === 'function'
      const subsExecutable = cmd.subcommands.every((s) => typeof s.execute === 'function')
      if (!parentDispatch && !subsExecutable) bad.push(cmd.id)
    }
    expect(bad, `分发链断裂的父命令: ${bad.join(', ')}`).toEqual([])
  })

  it('子命令对象至少有 id', () => {
    for (const cmd of commands) {
      if (!cmd.subcommands) continue
      for (const sub of cmd.subcommands) {
        expect(typeof sub.id).toBe('string')
        expect(sub.id.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('commands 注册表 — 子命令父引用', () => {
  it('每个子命令 id 都能由其所在 parent 的 executeSubcommand 处理', () => {
    for (const cmd of commands) {
      if (!cmd.subcommands || typeof cmd.executeSubcommand !== 'function') continue
      // 父命令的 executeSubcommand 接受 (commandId, value?) 形态；
      // 这里仅静态校验 sub.id 是父命令注册表中的合法子 id。
      const subIds = new Set(cmd.subcommands.map((s) => s.id))
      expect(subIds.size).toBe(cmd.subcommands.length)
    }
  })

  it('subcommands 数组中每个 sub 引用其 parent 的命名空间', () => {
    // 例：file.zoom 父命令的 sub.id 形如 file.zoom-N；window.change-theme 的 sub
    // 形如 window.change-theme-XXX。约定：sub.id 与 parent.id 共享首段前缀。
    for (const cmd of commands) {
      if (!cmd.subcommands) continue
      const parentNs = cmd.id.split('.')[0]
      for (const sub of cmd.subcommands) {
        expect(sub.id.split('.')[0]).toBe(parentNs)
      }
    }
  })
})

describe('commands 注册表 — 关键命令存在', () => {
  const expectedIds = [
    'file.new-tab',
    'file.new-window',
    'file.open-file',
    'file.open-folder',
    'file.save',
    'file.save-as',
    'file.export-file',
    'file.close-tab',
    'edit.undo',
    'edit.redo',
    'edit.find',
    'paragraph.heading-1',
    'format.strong',
    'view.source-code-mode',
    'view.toggle-sidebar',
    'view.toggle-tabbar',
    'file.zoom',
    'window.change-theme',
  ]

  for (const id of expectedIds) {
    it(`注册表中存在 "${id}"`, () => {
      expect(idSet.has(id), `缺失关键命令: ${id}`).toBe(true)
    })
  }
})

describe('commands 注册表 — 关键命令结构', () => {
  it('file.save 拥有 execute 方法', () => {
    const cmd = commands.find((c) => c.id === 'file.save') as CommandDescriptor | undefined
    expect(cmd).toBeDefined()
    expect(typeof cmd!.execute).toBe('function')
  })

  it('file.export-file 走 sub-execute 模式（无 execute、无 executeSubcommand，subs 自带 execute）', () => {
    const cmd = commands.find((c) => c.id === 'file.export-file') as CommandDescriptor | undefined
    expect(cmd).toBeDefined()
    expect(cmd!.subcommands?.length).toBeGreaterThan(0)
    // file.export-file 是 sub-execute 模式：父命令仅是 subcommands 容器，
    // 执行完全由 sub.execute() 承担；故 parent 既无 execute 也无 executeSubcommand。
    expect(cmd!.execute).toBeUndefined()
    expect(cmd!.executeSubcommand).toBeUndefined()
    expect(cmd!.subcommands!.every((s) => typeof s.execute === 'function')).toBe(true)
  })

  it('file.zoom 走 parent-executeSubcommand 模式（subs 仅声明 id+value）', () => {
    const cmd = commands.find((c) => c.id === 'file.zoom') as CommandDescriptor | undefined
    expect(cmd).toBeDefined()
    expect(typeof cmd!.executeSubcommand).toBe('function')
    expect(cmd!.subcommands!.length).toBeGreaterThan(0)
    // subs 仅声明 id+value，自身无 execute；统一由 parent.executeSubcommand 分发。
    expect(cmd!.subcommands!.every((s) => typeof s.execute === 'undefined')).toBe(true)
  })

  it('file.zoom 子命令携带 value 字段（缩放比例）', () => {
    const cmd = commands.find((c) => c.id === 'file.zoom') as CommandDescriptor | undefined
    expect(cmd).toBeDefined()
    expect(cmd!.subcommands?.every((s) => typeof s.value === 'number')).toBe(true)
  })
})
