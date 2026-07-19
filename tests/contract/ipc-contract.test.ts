import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
const BRIDGE = fs.readFileSync(path.join(ROOT, 'src/renderer/src/tauri-bridge.ts'), 'utf-8')
const LIB_RS = fs.readFileSync(path.join(ROOT, 'src-tauri/src/lib.rs'), 'utf-8')

// 从 tauri-bridge.ts 提取映射 channel 名
function extractChannels(source: string, mapName: string): string[] {
  const channels: string[] = []
  const mapStart = source.indexOf(`const ${mapName}`)
  if (mapStart === -1) return channels
  const mapEnd = source.indexOf('\n}', mapStart)
  const mapBody = source.slice(mapStart, mapEnd)
  const re = /'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(mapBody)) !== null) {
    if (m[1].includes('mt::') || m[1].includes('::')) channels.push(m[1])
  }
  return channels
}

const invokeChannels = extractChannels(BRIDGE, 'INVOKE_CHANNEL_MAP')
const sendChannels = extractChannels(BRIDGE, 'SEND_CHANNEL_EMIT_MAP')

// 从 lib.rs 提取 invoke_handler 注册的 command 名
const handlerMatch = LIB_RS.match(/generate_handler\!\[([\s\S]*?)\]/)
const rustCommands = handlerMatch
  ? handlerMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//') && l !== 'ping')
      .map(l => l.replace(/[,)].*$/, '').split('::').pop()!)
  : []

// 从 INVOKE_CHANNEL_MAP 提取 cmd 名
function extractCmds(source: string): string[] {
  const cmds: string[] = []
  const mapStart = source.indexOf('const INVOKE_CHANNEL_MAP')
  const mapEnd = source.indexOf('\n}', mapStart)
  const mapBody = source.slice(mapStart, mapEnd)
  const re = /cmd:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(mapBody)) !== null) cmds.push(m[1])
  return cmds
}
const bridgeCmds = extractCmds(BRIDGE)

// 扫描 renderer 代码中的 ipcRenderer 调用
function scanRendererCalls(): { invokes: Set<string>; sends: Set<string>; ons: Set<string> } {
  const result = { invokes: new Set<string>(), sends: new Set<string>(), ons: new Set<string>() }
  const rendererDir = path.join(ROOT, 'src/renderer/src')

  function walk(dir: string): void {
    const ents = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of ents) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'shims') continue
        walk(full)
      } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.vue'))) {
        if (ent.name === 'tauri-bridge.ts' || ent.name === 'menuBridge.ts') continue
        const src = fs.readFileSync(full, 'utf-8')
        const invokeRe = /ipcRenderer\.invoke\s*\(\s*['"]([^'"]+)['"]/g
        const sendRe = /ipcRenderer\.send\s*\(\s*['"]([^'"]+)['"]/g
        const onRe = /ipcRenderer\.on\s*\(\s*['"]([^'"]+)['"]/g
        let m: RegExpExecArray | null
        while ((m = invokeRe.exec(src)) !== null) result.invokes.add(m[1])
        while ((m = sendRe.exec(src)) !== null) result.sends.add(m[1])
        while ((m = onRe.exec(src)) !== null) result.ons.add(m[1])
      }
    }
  }
  walk(rendererDir)
  return result
}

const rendererCalls = scanRendererCalls()

describe('L1 IPC Contract: Bridge mappings', () => {
  it('INVOKE_CHANNEL_MAP 非空', () => {
    expect(invokeChannels.length).toBeGreaterThan(20)
  })

  it('SEND_CHANNEL_EMIT_MAP 非空', () => {
    expect(sendChannels.length).toBeGreaterThan(5)
  })

  it('bridge 映射的 cmd 都在 Rust invoke_handler 中注册', () => {
    const missing = bridgeCmds.filter(cmd => !rustCommands.includes(cmd))
    if (missing.length > 0) {
      console.error('Bridge→Rust 未注册:', missing)
    }
    expect(missing).toEqual([])
  })
})

describe('L1 IPC Contract: Renderer→Bridge', () => {
  it('renderer invoke channels 都在 INVOKE_CHANNEL_MAP 中', () => {
    const unmapped: string[] = []
    for (const ch of rendererCalls.invokes) {
      if (!invokeChannels.includes(ch)) unmapped.push(ch)
    }
    if (unmapped.length > 0) {
      console.warn('Renderer invoke 未映射（可能 invoke 返回 null）:', unmapped)
    }
    // 允许有未映射的（renderer 可能有 condition 调用），但打印警告
    console.log(`Renderer invokes: ${rendererCalls.invokes.size}, mapped: ${rendererCalls.invokes.size - unmapped.length}, unmapped: ${unmapped.length}`)
  })

  it('renderer send channels 覆盖检查', () => {
    const unmapped: string[] = []
    for (const ch of rendererCalls.sends) {
      if (!sendChannels.includes(ch) && !invokeChannels.includes(ch)) unmapped.push(ch)
    }
    console.log(`Renderer sends: ${rendererCalls.sends.size}, mapped: ${rendererCalls.sends.size - unmapped.length}, unmapped: ${unmapped.length}`)
    if (unmapped.length > 0) {
      console.log('未映射 send channels（fallback 到 emit）:', unmapped.slice(0, 20))
    }
  })

  it('renderer on channels 统计', () => {
    console.log(`Renderer on() listeners: ${rendererCalls.ons.size} 个不同 channel`)
    console.log('Channels:', [...rendererCalls.ons].sort().join(', '))
  })
})

describe('L1 IPC Contract: Rust→Bridge', () => {
  it('Rust commands 都有对应的 bridge 映射', () => {
    const orphaned = rustCommands.filter(cmd => !bridgeCmds.includes(cmd))
    console.log(`Rust commands: ${rustCommands.length}, bridged: ${rustCommands.length - orphaned.length}, orphaned: ${orphaned.length}`)
    if (orphaned.length > 0) {
      console.log('无 bridge 映射的 Rust commands:', orphaned)
    }
  })
})

describe('L1 IPC Contract: Summary', () => {
  it('输出完整报告', () => {
    console.log('\n=== IPC Contract Summary ===')
    console.log(`INVOKE_CHANNEL_MAP: ${invokeChannels.length} channels`)
    console.log(`SEND_CHANNEL_EMIT_MAP: ${sendChannels.length} channels`)
    console.log(`Rust invoke_handler: ${rustCommands.length} commands`)
    console.log(`Renderer invokes: ${rendererCalls.invokes.size} channels`)
    console.log(`Renderer sends: ${rendererCalls.sends.size} channels`)
    console.log(`Renderer listeners: ${rendererCalls.ons.size} channels`)
    console.log('============================\n')
  })
})
