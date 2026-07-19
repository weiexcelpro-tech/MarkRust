// 用 patch 后的 dist 触发右键，捕获 [DIAG-RL] 日志
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { ensureApp, rightClickAt } from './setup.mjs'

async function main() {
  const ws = await ensureApp()
  console.log('=== [DIAG-RL] 触发右键，捕获 console.log ===\n')

  // 收集 console.log
  const logs = []
  const origConsoleLog = await evaluate(ws, `
    window._diagLogs = [];
    const origLog = console.log;
    console.log = function(...args) {
      const s = args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a) } catch(e) { return String(a) }
      }).join(' | ');
      if (s.indexOf('[DIAG-RL]') >= 0) {
        window._diagLogs.push(s);
      }
      origLog.apply(console, args);
    };
    'console.log hijacked'
  `)
  console.log('console.log 劫持结果:', origConsoleLog)

  // 获取 contenteditable 中心点
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })())`))
  if (!rect) { console.log('❌ 无 contenteditable'); process.exit(1) }
  console.log('右键位置:', rect)

  // 触发右键
  console.log('\n>>> 触发右键...')
  await rightClickAt(ws, rect.x, rect.y)
  await sleep(800)

  // 读取日志
  const collected = JSON.parse(await evaluate(ws, `JSON.stringify(window._diagLogs)`))
  console.log('\n=== 收集到的 [DIAG-RL] 日志 ===')
  if (collected.length === 0) {
    console.log('❌ 无日志—说明 Rl 函数根本没被调用！')
    console.log('   这意味着 Vue 的 @contextmenu.prevent wrapper 没有调用 handler')
  } else {
    collected.forEach((log, i) => {
      console.log(`\n[${i}] ${log}`)
    })
  }

  // 检查菜单 DOM
  const menuCount = await evaluate(ws, `document.querySelectorAll('div[style*="z-index:99999"]').length`)
  console.log('\n菜单 DOM 数:', menuCount)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
