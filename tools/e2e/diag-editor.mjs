// 快速检查编辑器状态
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'
import { clickElement, clickAt, pressKey, insertText } from './setup.mjs'

async function main() {
  const ws = await connectCdp()
  console.log('=== 编辑器状态检查 ===')

  const info = JSON.parse(await evaluate(ws, `JSON.stringify({
    muContainer: !!document.querySelector('.mu-container'),
    muEditor: !!document.querySelector('.mu-editor'),
    sourceCode: !!document.querySelector('.source-code'),
    codemirror: !!document.querySelector('.CodeMirror'),
    activeClass: document.activeElement?.className || '',
    editorCount: document.querySelectorAll('.mu-container').length,
    contentEditable: document.querySelector('[contenteditable=true]')?.className || 'none'
  })`))
  console.log('初始状态:', info)

  // 截图看编辑器
  // 尝试点击 .mu-container
  console.log('\n尝试点击 .mu-container...')
  try {
    await clickElement(ws, '.mu-container')
    await sleep(300)
  } catch (e) { console.log('  clickElement 失败:', e.message) }

  const afterClick = JSON.parse(await evaluate(ws, `JSON.stringify({
    activeClass: document.activeElement?.className || '',
    contentEditable: document.querySelector('[contenteditable=true]')?.className || 'none'
  })`))
  console.log('点击后:', afterClick)

  // 尝试 insertText
  console.log('\n尝试 insertText "HELLO_TEST"...')
  await insertText(ws, 'HELLO_TEST')
  await sleep(500)

  const afterInput = JSON.parse(await evaluate(ws, `JSON.stringify({
    bodyHTML: document.body.innerHTML.includes('HELLO_TEST'),
    muContainer: document.querySelector('.mu-container')?.innerHTML?.includes('HELLO_TEST') || false,
    muEditor: document.querySelector('.mu-editor')?.innerHTML?.includes('HELLO_TEST') || false
  })`))
  console.log('输入后:', afterInput)

  // 尝试用 clickAt 点击编辑器中心
  console.log('\n尝试 clickAt 编辑器中心...')
  const rect = JSON.parse(await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.mu-container') || document.querySelector('.mu-editor');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
  })())`))
  console.log('编辑器矩形:', rect)
  if (rect) {
    await clickAt(ws, rect.x, rect.y)
    await sleep(300)
    await insertText(ws, 'WORLD_TEST')
    await sleep(500)
    const check = JSON.parse(await evaluate(ws, `JSON.stringify({
      body: document.body.innerHTML.includes('WORLD_TEST'),
      muContainer: document.querySelector('.mu-container')?.innerHTML?.includes('WORLD_TEST') || false
    })`))
    console.log('clickAt+insertText 后:', check)
  }

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
