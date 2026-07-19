import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

// ── 提取 Rust command 函数签名 ──
function extractRustCommands(): Map<string, string[]> {
  const commandsDir = join(ROOT, 'src-tauri/src/commands')
  const files = readdirSync(commandsDir).filter((f) => f.endsWith('.rs'))
  const result = new Map<string, string[]>()

  for (const file of files) {
    const content = readFileSync(join(commandsDir, file), 'utf-8')
    // 匹配 pub fn 或 pub async fn，提取函数名和参数
    const fnRegex = /pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g
    let match: RegExpExecArray | null
    while ((match = fnRegex.exec(content)) !== null) {
      const fnName = match[1]
      const paramsRaw = match[2]
      // 跳过需要 AppHandle/App 的参数，只保留业务参数
      const params = paramsRaw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && !p.includes('app:') && !p.includes('AppHandle') && !p.includes('App<') && !p.includes('_app'))
        .map((p) => {
          // 参数名是冒号前的部分
          const colonIdx = p.indexOf(':')
          return colonIdx > 0 ? p.substring(0, colonIdx).trim() : ''
        })
        .filter((p) => p)
      result.set(fnName, params)
    }
  }
  return result
}

// ── 提取 Bridge INVOKE_CHANNEL_MAP ──
function extractBridgeInvoke(): Map<string, { cmd: string; params: string[] }> {
  const content = readFileSync(join(ROOT, 'src/renderer/src/tauri-bridge.ts'), 'utf-8')
  const result = new Map<string, { cmd: string; params: string[] }>()

  // 匹配 'channel-name': { cmd: 'rust_cmd', map: ([a, b]) => ({ key1: a, key2: b }) }
  const entryRegex = /'([^']+)':\s*\{\s*cmd:\s*'([^']+)'[^}]*?map:\s*\([^)]*\)\s*=>\s*\(\{([^}]*)\}\)/g
  let match: RegExpExecArray | null
  while ((match = entryRegex.exec(content)) !== null) {
    const channel = match[1]
    const cmd = match[2]
    const objBody = match[3]
    // 提取对象 key
    const params = objBody
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p)
      .map((p) => {
        const colonIdx = p.indexOf(':')
        return colonIdx > 0 ? p.substring(0, colonIdx).trim() : ''
      })
      .filter((p) => p)
    result.set(channel, { cmd, params })
  }
  return result
}

const rustCommands = extractRustCommands()
const bridgeInvoke = extractBridgeInvoke()

describe('Bridge-Rust 参数契约', () => {
  it('Bridge 引用的每个 Rust command 都存在', () => {
    const missing: string[] = []
    for (const [, { cmd }] of bridgeInvoke) {
      if (!rustCommands.has(cmd)) {
        missing.push(cmd)
      }
    }
    expect(missing).toEqual([])
  })

  it('Bridge 传的参数名 ⊆ Rust 函数参数名', () => {
    const mismatches: string[] = []
    for (const [channel, { cmd, params }] of bridgeInvoke) {
      const rustParams = rustCommands.get(cmd)
      if (!rustParams) continue
      for (const p of params) {
        if (!rustParams.includes(p)) {
          mismatches.push(`${channel} → ${cmd}: bridge 传 '${p}'，Rust 参数为 [${rustParams.join(', ')}]`)
        }
      }
    }
    if (mismatches.length > 0) {
      console.error('参数名不匹配:\n', mismatches.join('\n'))
    }
    expect(mismatches).toEqual([])
  })
})
