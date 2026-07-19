// 诊断脚本 v7：isSaved 翻转时间线 + file_changed 自反馈验证
// 核心假设：FILE_SAVE 写盘 → Tauri 文件监听器检测变更 → mt::update-file
//          → LISTEN_FOR_FILE_CHANGE 把 isSaved 改回 false（自反馈循环）
// 验证方法：FILE_SAVE 后每 50ms 记录 isSaved，看是否先变 true 再变 false
import { connectCdp, evaluate, cdp, sleep } from './lib/cdp.mjs'
import {
  invokeStoreAction, getCurrentFile, createTestFile, readFileAbs,
  clickAt, waitForElement, waitForCurrentFile
} from './setup.mjs'

const TEST_DIR = 'C:\\Work\\202607\\MarkText优化\\marktext-tauri\\tools\\e2e\\.test-data'

async function main() {
  const ws = await connectCdp()
  console.log('=== Diag v7: isSaved 翻转时间线 + file_changed 自反馈验证 ===\n')

  // ─── Step 1: 清空 + 打开文件 ───────────────────────────────
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.tabs = []; store.currentFile = null
    return 'cleared'
  })()`)

  const markText = `DIAGV7_MARK_${Date.now()}`
  const testFileName = 'diag-v7-test.md'
  const originalContent = '# Diag V7\n\n初始内容\n'
  const testFilePath = createTestFile(testFileName, originalContent)
  const modifiedContent = originalContent + '\n' + markText + '\n'

  await invokeStoreAction(ws, 'project', 'OPEN_PROJECT', TEST_DIR.replace(/\\/g, '/'))
  await waitForElement(ws, '.side-bar-file', 8000)

  const found = await evaluate(ws, `(() => {
    const files = Array.from(document.querySelectorAll('.side-bar-file'));
    const target = files.find(f => (f.getAttribute('title')||'').includes('diag-v7-test'));
    if (!target) return JSON.stringify({ found: false });
    const r = target.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`)
  const f = JSON.parse(found)
  if (!f.found) { console.log('未找到文件!'); process.exit(1) }
  await clickAt(ws, f.x, f.y)
  await waitForCurrentFile(ws, 8000)
  const cf1 = await getCurrentFile(ws)
  console.log('[Step 1] 文件已打开:', cf1?.filename, 'id=' + cf1?.id, 'isSaved=' + cf1?.isSaved)

  // ─── Step 2: 注入探针 ──────────────────────────────────────
  console.log('\n[Step 2] 注入探针: mt::tab-saved + mt::update-file listener')
  await evaluate(ws, `(() => {
    window.__diag7 = { timeline: [], tabSaved: [], updateFile: [] }
    // mt::tab-saved 探针
    window.electron.ipcRenderer.on('mt::tab-saved', (e, id) => {
      const app = document.querySelector('#app');
      const pinia = app.__vue_app__.config.globalProperties.$pinia;
      const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
      const tab = store.tabs.find(t => t.id === id);
      window.__diag7.tabSaved.push({
        id, time: Date.now(), tabFound: !!tab, isSavedBefore: tab?.isSaved
      })
    })
    // mt::update-file 探针（文件变更监听器）
    window.electron.ipcRenderer.on('mt::update-file', (e, payload) => {
      const app = document.querySelector('#app');
      const pinia = app.__vue_app__.config.globalProperties.$pinia;
      const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
      const { type, change } = payload || {}
      const pathname = change?.pathname || ''
      const tab = store.tabs.find(t => t.pathname && pathname &&
        t.pathname.replace(/\\\\/g,'/') === pathname.replace(/\\\\/g,'/'))
      const newMarkdown = change?.data?.markdown
      window.__diag7.updateFile.push({
        type, time: Date.now(),
        pathname: pathname.slice(-40),
        tabFound: !!tab, tabId: tab?.id,
        tabMarkdownLen: tab?.markdown?.length,
        newMarkdownLen: typeof newMarkdown === 'string' ? newMarkdown.length : null,
        sameContent: typeof newMarkdown === 'string' && tab ? newMarkdown === tab.markdown : null,
        tabIsSaved: tab?.isSaved
      })
    })
    return 'probes installed'
  })()`)

  // ─── Step 3: 修改 markdown ─────────────────────────────────
  console.log('\n[Step 3] 修改 markdown (len=' + modifiedContent.length + ')')
  await evaluate(ws, `(() => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    store.currentFile.markdown = ${JSON.stringify(modifiedContent)};
    store.currentFile.isSaved = false;
    return JSON.stringify({ mdLen: store.currentFile.markdown.length, isSaved: store.currentFile.isSaved })
  })()`)

  // ─── Step 4: FILE_SAVE + 时间线监控 ────────────────────────
  console.log('\n[Step 4] 启动时间线监控(50ms间隔, 3秒), 100ms后调用 FILE_SAVE()')

  // 启动时间线监控（异步运行3秒）
  const timelinePromise = evaluate(ws, `(async () => {
    const app = document.querySelector('#app');
    const pinia = app.__vue_app__.config.globalProperties.$pinia;
    const store = Array.from(pinia._s.values()).find(s => s.$id === 'editor');
    const startTime = Date.now()
    while (Date.now() - startTime < 3000) {
      const cf = store.currentFile
      window.__diag7.timeline.push({
        t: Date.now() - startTime,
        isSaved: cf?.isSaved,
        notifLen: cf?.notifications?.length || 0
      })
      await new Promise(r => setTimeout(r, 50))
    }
    return 'timeline done'
  })()`)

  await sleep(100)
  console.log('  调用 FILE_SAVE()...')
  await invokeStoreAction(ws, 'editor', 'FILE_SAVE')
  console.log('  FILE_SAVE() 已返回, 等待时间线完成...')

  await timelinePromise
  console.log('  时间线监控完成')

  // ─── Step 5: 分析结果 ──────────────────────────────────────
  const diag = JSON.parse(await evaluate(ws, `JSON.stringify(window.__diag7)`))

  console.log('\n[Step 5] isSaved 时间线变化:')
  let prevSaved = null
  const changes = []
  for (const point of diag.timeline) {
    if (point.isSaved !== prevSaved) {
      changes.push(point)
      console.log(`  t=${point.t}ms: isSaved=${point.isSaved}, notifLen=${point.notifLen}`)
      prevSaved = point.isSaved
    }
  }

  console.log('\n  mt::tab-saved 事件数:', diag.tabSaved.length)
  for (const ts of diag.tabSaved) {
    console.log('   ', JSON.stringify(ts))
  }

  console.log('\n  mt::update-file 事件数:', diag.updateFile.length)
  for (const uf of diag.updateFile) {
    console.log('   ', JSON.stringify(uf))
  }

  // ─── Step 6: 最终状态 ──────────────────────────────────────
  const cf2 = await getCurrentFile(ws)
  console.log('\n[Step 6] 最终状态:')
  console.log('  isSaved:', cf2?.isSaved)
  console.log('  markdown len:', cf2?.markdown?.length)
  console.log('  notifications:', JSON.stringify(cf2?.notifications?.map(n => ({ type: n.exclusiveType, msg: n.msg?.slice(0, 40) }))))

  // ─── Step 7: 磁盘文件 ──────────────────────────────────────
  try {
    const disk = readFileAbs(testFilePath)
    console.log('\n[Step 7] 磁盘文件:')
    console.log('  长度:', disk.length, '(原始=' + originalContent.length + ', 修改=' + modifiedContent.length + ')')
    console.log('  包含 markText:', disk.includes(markText))
  } catch (e) { console.log('  读盘失败:', e.message) }

  // ─── 结论 ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════')
  console.log('=== 诊断结论 ===')
  console.log('═══════════════════════════════════════════')
  const tabSavedReceived = diag.tabSaved.length > 0
  const updateFileReceived = diag.updateFile.length > 0
  const everTrue = diag.timeline.some(p => p.isSaved === true)
  const finalState = diag.timeline[diag.timeline.length - 1]?.isSaved

  console.log('mt::tab-saved 收到?', tabSavedReceived ? '✅' : '❌')
  console.log('mt::update-file 收到?', updateFileReceived ? '✅' : '❌')
  console.log('isSaved 曾为 true?', everTrue ? '✅' : '❌')
  console.log('isSaved 最终值:', finalState)

  if (tabSavedReceived && everTrue && finalState === false) {
    console.log('\n★ file_changed 自反馈根因确认!')
    console.log('  → FILE_SAVE 写盘 → isSaved=true → 文件监听器检测变更 → isSaved=false')
    if (updateFileReceived) {
      const uf = diag.updateFile[0]
      console.log('  → update-file type:', uf.type, 'sameContent:', uf.sameContent)
      if (uf.sameContent === false) {
        console.log('  → 磁盘内容 != tab.markdown (可能行尾/编码转换导致)')
      }
    }
    console.log('\n  修复方案: 保存后抑制文件监听器，或让 file_changed 比较使用保存后的 markdown')
  } else if (tabSavedReceived && !everTrue) {
    console.log('\n★ mt::tab-saved 收到但 isSaved 从未变 true')
    console.log('  → editor store 的 mt::tab-saved 监听器可能未注册/未执行')
  } else if (!tabSavedReceived) {
    console.log('\n★ mt::tab-saved 未收到')
    console.log('  → FILE_SAVE 链路断裂或 invoke("markdown_save") 失败')
  } else if (finalState === true) {
    console.log('\n★ 保存正常! isSaved 最终为 true')
    console.log('  → 之前的失败可能是脏状态导致')
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
