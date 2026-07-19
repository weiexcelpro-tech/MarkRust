// IPC Channel Contract Scanner for the MarkText Tauri 2 migration.
//
// Cross-validates three IPC data sources:
//   1. Renderer call sites — window.electron.ipcRenderer.{invoke,send,on,...}
//      scanned across src/renderer/src/ (.ts/.vue/.js, tauri-bridge.ts excluded).
//   2. Bridge mapping tables — INVOKE_CHANNEL_MAP / SEND_CHANNEL_EMIT_MAP /
//      SENDSYNC_CHANNEL_MAP declared in src/renderer/src/tauri-bridge.ts.
//   3. Rust command registry — tauri::generate_handler![...] block in
//      src-tauri/src/lib.rs.
//
// Run:  npx tsx scripts/scan-ipc-channels.ts
// Exit: 0 = PASS (no broken invoke mappings / no missing Rust cmds),
//       1 = FAIL.
//
// Regex-based; not a TypeScript AST walk. Sufficient for an L1 contract scan.
// invoke calls missing from INVOKE_CHANNEL_MAP are HARD fails (bridge returns
// null → broken feature). send calls missing from SEND_CHANNEL_EMIT_MAP are
// SOFT warnings (bridge falls back to emit('renderer:'+channel, args)). on / once
// are listener hooks for Rust→renderer events and never fail the build.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER_ROOT = path.join(PROJECT_ROOT, 'src', 'renderer', 'src')
const BRIDGE_FILE = path.join(RENDERER_ROOT, 'tauri-bridge.ts')
const RUST_LIB_FILE = path.join(PROJECT_ROOT, 'src-tauri', 'src', 'lib.rs')

const USE_COLOR = process.stdout.isTTY
const c = {
  green: (s: string) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s)
}

type IpcMethod = 'invoke' | 'send' | 'on' | 'once' | 'sendSync'

interface RendererCall {
  channel: string
  method: IpcMethod
  file: string
  line: number
}

interface InvokeMapEntry {
  channel: string
  cmd: string
  line: number
}

interface SendMapEntry {
  channel: string
  line: number
}

function walkFiles(root: string, exts: string[]): string[] {
  const out: string[] = []
  if (!fs.existsSync(root)) return out
  const stack: string[] = [root]
  while (stack.length) {
    const cur = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
        stack.push(full)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (exts.includes(ext)) out.push(full)
      }
    }
  }
  return out
}

function rel(file: string): string {
  return path.relative(PROJECT_ROOT, file).replace(/\\/g, '/')
}

// Strip // line comments and /* block comments */ while preserving string
// literals (so channels mentioned in prose don't get counted as call sites).
function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  let quote: '"' | "'" | '`' | null = null
  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i++
      }
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

// Match ipcRenderer.METHOD(quote channel quote). Tolerant to newlines between
// `(` and the literal (prettier formats long .invoke() across multiple lines).
const CALL_RE = /ipcRenderer\s*\.\s*(invoke|send|on|once|sendSync)\s*\(\s*(['"])([^'"]+?)\2/g

function buildOffsetToLine(text: string): (off: number) => number {
  const lineStarts: number[] = [0]
  for (const ln of text.split('\n')) {
    lineStarts.push(lineStarts[lineStarts.length - 1] + ln.length + 1)
  }
  return (off: number) => {
    let lo = 0,
      hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function scanRendererCalls(): RendererCall[] {
  const files = walkFiles(RENDERER_ROOT, ['.ts', '.vue', '.js'])
  const calls: RendererCall[] = []
  for (const file of files) {
    if (path.resolve(file) === path.resolve(BRIDGE_FILE)) continue
    const stripped = stripComments(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    const offsetToLine = buildOffsetToLine(stripped)
    const re = new RegExp(CALL_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) !== null) {
      calls.push({
        channel: m[3],
        method: m[1] as IpcMethod,
        file: rel(file),
        line: offsetToLine(m.index)
      })
    }
  }
  return calls
}

// Locate `NAME ... = { ... }` block via string-aware brace matching starting
// from the assignment's opening `{`. `[^]*?` tolerates `>` characters inside
// the type annotation (e.g. `Record<..., (...) => unknown>`, where `=>` would
// fool a naive `[^>]+` regex). String/char/template literals are skipped so
// braces inside type annotations (`{ cmd: string }`) and map bodies
// (`emit('x', { y: 1 })`) don't prematurely close the block.
function extractBlock(
  lines: string[],
  name: string
): { startLine: number; body: string } | null {
  const declRe = new RegExp(`\\b${name}\\b[^]*?=\\s*\\{`)
  for (let i = 0; i < lines.length; i++) {
    const dm = declRe.exec(lines[i])
    if (!dm) continue
    // Start walking from the END of the declRe match (just past the `{`).
    const startOffInLine = dm.index + dm[0].length
    const startLine = i
    let depth = 1
    let body = '{'
    let quote: '"' | "'" | '`' | null = null
    let tmplExprDepth = 0
    for (let j = startLine; j < lines.length; j++) {
      const ln = j === startLine ? lines[j].slice(startOffInLine) : lines[j]
      for (let k = 0; k < ln.length; k++) {
        const ch = ln[k]
        const next = ln[k + 1]
        if (quote) {
          body += ch
          if (ch === '\\') {
            body += next ?? ''
            k++
            continue
          }
          if (quote === '`' && ch === '$' && next === '{') {
            body += '{'
            tmplExprDepth++
            k++
            continue
          }
          if (quote === '`' && tmplExprDepth > 0 && ch === '}') {
            tmplExprDepth--
            if (tmplExprDepth === 0) {
              // closing ${...} returns to template string mode
            }
            continue
          }
          if (ch === quote && tmplExprDepth === 0) quote = null
          continue
        }
        body += ch
        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch
          continue
        }
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) return { startLine, body }
        }
      }
      body += '\n'
    }
  }
  return null
}

const INVOKE_ENTRY_RE = /(['"])([^'"]+?)\1\s*:\s*\{\s*cmd\s*:\s*(['"])([^'"]+?)\3/g
const EMIT_ENTRY_RE = /(['"])([^'"]+?)\1\s*:\s*(?:async\s*)?\(/g

function lineOf(block: { startLine: number; body: string }, idx: number): number {
  return block.startLine + block.body.slice(0, idx).split('\n').length - 1
}

function parseBridgeMaps() {
  const lines = fs.readFileSync(BRIDGE_FILE, 'utf8').split(/\r?\n/)
  const invokeMap: InvokeMapEntry[] = []
  const sendEmitMap: SendMapEntry[] = []
  const sendsyncMap: SendMapEntry[] = []

  const invBlock = extractBlock(lines, 'INVOKE_CHANNEL_MAP')
  if (invBlock) {
    const re = new RegExp(INVOKE_ENTRY_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(invBlock.body)) !== null) {
      invokeMap.push({ channel: m[2], cmd: m[4], line: lineOf(invBlock, m.index) })
    }
  }
  const sendBlock = extractBlock(lines, 'SEND_CHANNEL_EMIT_MAP')
  if (sendBlock) {
    const re = new RegExp(EMIT_ENTRY_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(sendBlock.body)) !== null) {
      sendEmitMap.push({ channel: m[2], line: lineOf(sendBlock, m.index) })
    }
  }
  const syncBlock = extractBlock(lines, 'SENDSYNC_CHANNEL_MAP')
  if (syncBlock) {
    const re = new RegExp(EMIT_ENTRY_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(syncBlock.body)) !== null) {
      sendsyncMap.push({ channel: m[2], line: lineOf(syncBlock, m.index) })
    }
  }
  return { invokeMap, sendEmitMap, sendsyncMap }
}

// Extract command identifiers from generate_handler![...]. Accepts both bare
// ids (ping) and path-qualified (commands::fs::fs_is_file); last segment wins.
function parseRustCommands(): string[] {
  const text = fs.readFileSync(RUST_LIB_FILE, 'utf8')
  const startIdx = text.indexOf('generate_handler!')
  if (startIdx < 0) return []
  const braceStart = text.indexOf('[', startIdx)
  if (braceStart < 0) return []
  let depth = 0
  let end = -1
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return []
  const body = text
    .slice(braceStart + 1, end)
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  const out: string[] = []
  const re = /([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const segs = m[1].split('::')
    const name = segs[segs.length - 1]
    if (name === 'commands') continue
    out.push(name)
  }
  return Array.from(new Set(out))
}

// Find invoke('cmd') literals anywhere in tauri-bridge.ts (covers both the
// direct fileUtils/shell/clipboard APIs and SEND_CHANNEL_EMIT_MAP bodies).
function extractAllInvokeCmds(file: string): { cmd: string; line: number }[] {
  if (!fs.existsSync(file)) return []
  const stripped = stripComments(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
  const offsetToLine = buildOffsetToLine(stripped)
  const out: { cmd: string; line: number }[] = []
  const re = /invoke(?:<[^>]*>)?\(\s*(['"])([a-z0-9_]+)\1/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    out.push({ cmd: m[2], line: offsetToLine(m.index) })
  }
  return out
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function pct(num: number, den: number): string {
  if (den === 0) return 'n/a'
  return `${((num / den) * 100).toFixed(1)}%`
}

function printSection(title: string): void {
  console.log()
  console.log(c.bold(`--- ${title} ---`))
}

function main(): number {
  const calls = scanRendererCalls()
  const { invokeMap, sendEmitMap, sendsyncMap } = parseBridgeMaps()
  const rustCmds = parseRustCommands()

  const invokeChannelToCmd = new Map<string, string>()
  for (const e of invokeMap) invokeChannelToCmd.set(e.channel, e.cmd)
  const sendEmitChannels = new Set(sendEmitMap.map((e) => e.channel))
  const sendsyncChannels = new Set(sendsyncMap.map((e) => e.channel))
  const rustCmdSet = new Set(rustCmds)

  const invokeChannels = dedupe(
    calls.filter((cc) => cc.method === 'invoke').map((cc) => cc.channel)
  )
  const sendChannels = dedupe(
    calls.filter((cc) => cc.method === 'send').map((cc) => cc.channel)
  )
  const onChannels = dedupe(
    calls
      .filter((cc) => cc.method === 'on' || cc.method === 'once')
      .map((cc) => cc.channel)
  )
  const sendSyncChannels = dedupe(
    calls.filter((cc) => cc.method === 'sendSync').map((cc) => cc.channel)
  )

  const bridgeInvokeCmds = extractAllInvokeCmds(BRIDGE_FILE)
  // A Rust cmd is "covered" if tauri-bridge.ts calls invoke('cmd') directly
  // (e.g. fileUtils.readFile → fs_read_file) — the renderer reaches it through
  // the bridge's high-level window.* API rather than via ipcRenderer.invoke.
  const bridgeCoveredCmdSet = new Set(bridgeInvokeCmds.map((x) => x.cmd))

  console.log(c.bold(c.cyan('=== IPC Channel Contract Report ===')))
  console.log(c.dim(`scan root:    ${rel(RENDERER_ROOT)}`))
  console.log(c.dim(`bridge file:  ${rel(BRIDGE_FILE)}`))
  console.log(c.dim(`rust file:    ${rel(RUST_LIB_FILE)}`))
  console.log(
    c.dim(
      `loaded: ${calls.length} call sites, ${invokeMap.length} invoke-mapped, ${sendEmitMap.length} send-mapped, ${rustCmds.length} rust commands`
    )
  )

  printSection('Renderer → Bridge mapping (ipcRenderer.invoke)')
  let invokeBroken = 0
  for (const ch of invokeChannels) {
    const cmd = invokeChannelToCmd.get(ch)
    const sites = calls.filter((cc) => cc.method === 'invoke' && cc.channel === ch)
    const where = sites.map((s) => `${s.file}:${s.line}`).join(', ')
    if (cmd) {
      console.log(
        `  ${c.green('✓')} ${ch} → ${cmd} ${c.dim('(mapped in INVOKE_CHANNEL_MAP)')}`
      )
    } else {
      invokeBroken++
      console.log(
        `  ${c.red('✗')} ${ch} ${c.red('NOT MAPPED in INVOKE_CHANNEL_MAP')} ${c.dim(`(${where})`)}`
      )
    }
  }

  printSection('Renderer → Bridge mapping (ipcRenderer.send)')
  let sendFallback = 0
  for (const ch of sendChannels) {
    const sites = calls.filter((cc) => cc.method === 'send' && cc.channel === ch)
    const where = sites.map((s) => `${s.file}:${s.line}`).join(', ')
    if (sendEmitChannels.has(ch)) {
      console.log(`  ${c.green('✓')} ${ch} ${c.dim('(mapped in SEND_CHANNEL_EMIT_MAP)')}`)
    } else {
      sendFallback++
      console.log(
        `  ${c.yellow('⚠')} ${ch} ${c.yellow('unmapped; bridge falls back to emit(renderer:' + ch + ')')} ${c.dim(`(${where})`)}`
      )
    }
  }

  printSection('Renderer listeners (ipcRenderer.on / once)')
  for (const ch of onChannels) {
    const sites = calls.filter(
      (cc) => (cc.method === 'on' || cc.method === 'once') && cc.channel === ch
    )
    const where = sites.map((s) => `${s.file}:${s.line}`).join(', ')
    console.log(`  ${c.cyan('•')} ${ch} ${c.dim(`(listener; ${where})`)}`)
  }

  if (sendSyncChannels.length) {
    printSection('Renderer sendSync (stubbed by bridge)')
    for (const ch of sendSyncChannels) {
      const mapped = sendsyncChannels.has(ch)
      const mark = mapped ? c.green('✓') : c.yellow('⚠')
      console.log(
        `  ${mark} ${ch} ${c.dim(mapped ? '(in SENDSYNC_CHANNEL_MAP)' : '(no handler; bridge returns null)')}`
      )
    }
  }

  printSection('Bridge → Rust command')
  let rustMissing = 0
  for (const entry of invokeMap) {
    if (rustCmdSet.has(entry.cmd)) {
      console.log(
        `  ${c.green('✓')} ${entry.cmd} ${c.dim(`(from ${entry.channel}; registered in invoke_handler)`)}`
      )
    } else {
      rustMissing++
      console.log(
        `  ${c.red('✗')} ${entry.cmd} ${c.red('NOT FOUND in invoke_handler')} ${c.dim(`(from ${entry.channel} @ ${rel(BRIDGE_FILE)}:${entry.line})`)}`
      )
    }
  }
  for (const { cmd, line } of bridgeInvokeCmds) {
    if (rustCmdSet.has(cmd)) {
      console.log(
        `  ${c.green('✓')} ${cmd} ${c.dim(`(direct invoke in ${rel(BRIDGE_FILE)}:${line})`)}`
      )
    } else {
      rustMissing++
      console.log(
        `  ${c.red('✗')} ${cmd} ${c.red('NOT FOUND in invoke_handler')} ${c.dim(`(direct invoke in ${rel(BRIDGE_FILE)}:${line})`)}`
      )
    }
  }

  printSection('Rust commands → Bridge coverage')
  const cmdToBridgeChannel = new Map<string, string>()
  for (const e of invokeMap) cmdToBridgeChannel.set(e.cmd, e.channel)
  for (const { cmd } of bridgeInvokeCmds) {
    if (!cmdToBridgeChannel.has(cmd)) {
      cmdToBridgeChannel.set(cmd, `<direct invoke in ${rel(BRIDGE_FILE)}>`)
    }
  }
  let orphaned = 0
  for (const cmd of rustCmds) {
    const bridgeCh = cmdToBridgeChannel.get(cmd)
    const coveredByDirectInvoke = bridgeCoveredCmdSet.has(cmd)
    if (bridgeCh) {
      const calledFromRenderer =
        coveredByDirectInvoke ||
        bridgeCh.startsWith('<') ||
        invokeChannels.includes(bridgeCh) ||
        sendChannels.includes(bridgeCh)
      if (calledFromRenderer) {
        const via = coveredByDirectInvoke && !bridgeCh.startsWith('<')
          ? `${bridgeCh} + direct bridge API`
          : bridgeCh
        console.log(`  ${c.green('✓')} ${cmd} ${c.dim(`(${via})`)}`)
      } else {
        console.log(
          `  ${c.yellow('⚠')} ${cmd} ${c.yellow('mapped but NOT called from renderer')} ${c.dim(`(via ${bridgeCh})`)}`
        )
      }
    } else {
      orphaned++
      console.log(
        `  ${c.yellow('⚠')} ${cmd} ${c.yellow('no renderer caller / no bridge mapping')} ${c.dim('(orphan command)')}`
      )
    }
  }

  const totalInvoke = invokeChannels.length
  const mappedInvoke = totalInvoke - invokeBroken
  const totalSend = sendChannels.length
  const mappedSend = totalSend - sendFallback
  const totalRust = rustCmds.length

  console.log()
  console.log(c.bold('--- Summary ---'))
  console.log(`  Renderer invoke channels : ${totalInvoke}`)
  console.log(
    `    mapped                 : ${mappedInvoke} / ${totalInvoke} (${pct(mappedInvoke, totalInvoke)})`
  )
  console.log(`    broken (hard fail)     : ${c.red(String(invokeBroken))}`)
  console.log(`  Renderer send channels   : ${totalSend}`)
  console.log(
    `    explicitly mapped      : ${mappedSend} / ${totalSend} (${pct(mappedSend, totalSend)})`
  )
  console.log(`    fallback emit          : ${sendFallback} (soft warning)`)
  console.log(`  Renderer listeners (on)  : ${onChannels.length}`)
  console.log(`  Rust commands registered : ${totalRust}`)
  console.log(`    missing from registry  : ${c.red(String(rustMissing))}`)
  console.log(`    orphaned (no caller)   : ${orphaned}`)

  const hardFails = invokeBroken + rustMissing
  console.log()
  if (hardFails === 0) {
    console.log(
      c.bold(
        c.green(`PASS: 0 broken mappings (${invokeBroken} invoke, ${rustMissing} rust)`)
      )
    )
    return 0
  }
  console.log(
    c.bold(
      c.red(
        `FAIL: ${hardFails} broken mapping(s) — ${invokeBroken} invoke, ${rustMissing} rust`
      )
    )
  )
  return 1
}

process.exit(main())
