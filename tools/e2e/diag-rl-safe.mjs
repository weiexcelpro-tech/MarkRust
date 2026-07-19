// 带超时保护 - 复用已有 lib/cdp.mjs
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT[${label}]`)), ms))
  ])
}

async function main() {
  console.log('=== [带超时] DIAG-RL 诊断 ===')
  const ws = await withTimeout(connectCdp(), 10000, 'connectCdp')
  console.log('✅ CDP 已连接')

  await withTimeout(evaluate(ws, `
    window._diagLogs = [];
    const origLog = console.log;
    console.log = function(...args) {
      const s = args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a).slice(0,300) : String(a) } catch(e) { return String(a) } }).join(' | ');
      if (s.indexOf('[DIAG-RL]') >= 0) window._diagLogs.push(s);
      origLog.apply(console, args);
    };
    'ok'
  `), 5000, 'hijack')
  console.log('✅ console.log 已劫持')

  const rectStr = await withTimeout(evaluate(ws, `JSON.stringify((()=>{const el=document.querySelector('[contenteditable=true]');if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())`), 5000, 'get-rect')
  const rect = JSON.parse(rectStr)
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('✅ 右键位置:', rect.x, rect.y)

  console.log('>>> 触发右键...')
  await ws.send(JSON.stringify({ id: 1, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', clickCount: 1 } }))
  await ws.send(JSON.stringify({ id: 2, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', clickCount: 1 } }))
  await sleep(800)

  const logsStr = await withTimeout(evaluate(ws, `JSON.stringify(window._diagLogs)`), 5000, 'read-logs')
  const arr = JSON.parse(logsStr)
  console.log('\n=== [DIAG-RL] 日志 ===')
  if (arr.length === 0) console.log('❌ 无日志 — Rl 没被调用')
  else arr.forEach((l, i) => console.log(`[${i}] ${l}`))

  const menuCount = await withTimeout(evaluate(ws, `document.querySelectorAll('div[style*="z-index:99999"]').length`), 5000, 'menu-count')
  console.log('\n菜单 DOM 数:', menuCount)

  process.exit(0)
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
