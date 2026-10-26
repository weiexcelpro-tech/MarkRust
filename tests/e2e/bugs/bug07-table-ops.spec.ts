/**
 * B07 表格中不能插入列；插入行后 Ctrl-Z 撤销无效 —— TC-B07-01/02/03
 *
 * UI 入口（muya v1.1.6）：hover 表格右缘 20px → 出现右侧拖拽条（mu-table-drag-bar），
 * 快速单击拖拽条 → 行/列菜单（mu-table-bar-tools，toolList.right 仅含行操作）；
 * 勘察疑点：tableDragBar._mouseup 仅在 barType==='right' 时 emit 'muya-table-bar'，
 * bottom barType（列操作入口）永远打不开菜单 → UI 层无列插入入口（B07-01 验证点）。
 * B07-03 按任务说明直接走 muya 实例方法（cell.__MUYA_BLOCK__.table.insertRow/insertColumn）
 * 验证引擎层边界行为（首/末列、连续撤销、对齐保留）。
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { openDoc, getMarkdown, fatalErrors, collectPageErrors } from './_helpers'

test.setTimeout(120_000)


const TABLE_DOC = [
  '# Table Demo',
  '',
  '| A | B | C |',
  '| --- | --- | --- |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '',
  '| Left | Center | Right |',
  '| :--- | :---: | ---: |',
  '| l1 | c1 | r1 |',
  '| l2 | c2 | r2 |',
  '',
].join('\n')

const firstTable = (page: Page): Locator => page.locator('.mu-editor table').first()

async function rowCount(page: Page): Promise<number> {
  return firstTable(page).locator('tr').count()
}
async function colCount(page: Page): Promise<number> {
  return firstTable(page).locator('tr').first().locator('td').count()
}

/**
 * 在第一个表格末行第 colIdx 个单元格正下方 3-12px 处 hover（触发 bottom 拖拽条）。
 * 勘察修正（B07-01）：tableDragBar 的 mousemove 判定是「光标处无单元格 &&
 * 光标上方 20px 处有单元格 → bottom bar」，因此 bottom bar 的悬停带在
 * 表格末行下缘之外 —— 表头下方 hover 永远命中下一行单元格，bar 不出现
 * （与原 mock 证据一致：hover 单元格下方 bottom bar 不弹出）。
 */
async function hoverBelowCell(page: Page, colIdx: number): Promise<void> {
  const lastRow = firstTable(page).locator('tr').last()
  const cell = lastRow.locator('td').nth(colIdx)
  const box = await cell.boundingBox()
  if (!box) throw new Error('表格单元格无 boundingBox')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 3, { steps: 4 })
  await page.waitForTimeout(500)
}

/** 在第一个表格任一行最后一列单元格右缘外 5px 处 hover（触发 right 拖拽条） */
async function hoverRightOfCell(page: Page, rowIdx: number): Promise<void> {
  const row = firstTable(page).locator('tr').nth(rowIdx)
  const cells = row.locator('td')
  const last = cells.nth((await cells.count()) - 1)
  const box = await last.boundingBox()
  if (!box) throw new Error('表格单元格无 boundingBox')
  await page.mouse.move(box.x + box.width + 5, box.y + box.height / 2, { steps: 4 })
  await page.waitForTimeout(500)
}

const DRAG_BAR = '.mu-float-container.mu-table-drag-bar'
const ROWCOL_MENU = '.mu-float-container.mu-table-bar-tools'

/** 快速单击拖拽条（<300ms，不触发拖拽），返回菜单是否弹出 */
async function clickDragBar(page: Page): Promise<boolean> {
  const bar = page.locator(DRAG_BAR)
  try {
    await bar.click({ timeout: 2000 })
  } catch {
    return false
  }
  await page.waitForTimeout(500)
  return page.locator(ROWCOL_MENU).isVisible()
}

test('TC-B07-01: 表格内插入列（UI 入口）', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\table-demo.md', TABLE_DOC)
  await expect(firstTable(page)).toBeVisible({ timeout: 15000 })
  expect(await colCount(page)).toBe(3)
  expect(await rowCount(page)).toBe(3)

  const problems: string[] = []

  // 入口 1：bottom bar（列操作的工具List 定义在 toolList.bottom）
  await hoverBelowCell(page, 1)
  let bottomBarShown = await page.locator(DRAG_BAR).isVisible().catch(() => false)
  if (!bottomBarShown) {
    // 诊断：hover 点的命中元素 + 更远偏移重试一次
    const diag = await page.evaluate(() => {
      const t = document.querySelector('.mu-editor table')
      const rows = t?.querySelectorAll('tr')
      const td = rows?.[rows.length - 1]?.querySelector('td')
      if (!td) return null
      const b = td.getBoundingClientRect()
      const x = b.x + b.width / 2
      const y = b.bottom + 3
      return {
        at: [Math.round(x), Math.round(y)],
        elsAt: document.elementsFromPoint(x, y).map((e) => `${e.tagName}.${(e.className || '').toString().slice(0, 40)}`).slice(0, 4),
        elsAbove: document.elementsFromPoint(x, y - 20).map((e) => `${e.tagName}.${(e.className || '').toString().slice(0, 40)}`).slice(0, 4),
      }
    })
    // eslint-disable-next-line no-console
    console.log('[B07-01] bottom-bar 未现，命中诊断:', JSON.stringify(diag))
    const lastRow = firstTable(page).locator('tr').last()
    const cell = lastRow.locator('td').nth(1)
    const box = await cell.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 12, { steps: 4 })
      await page.waitForTimeout(600)
      bottomBarShown = await page.locator(DRAG_BAR).isVisible().catch(() => false)
    }
  }
  if (!bottomBarShown) {
    problems.push('hover 单元格下方未出现表格拖拽条（bottom bar）')
  } else {
    const menuOpened = await clickDragBar(page)
    if (!menuOpened) {
      problems.push('点击 bottom 拖拽条后行/列菜单未弹出（tableDragBar._mouseup 仅对 right barType emit muya-table-bar，列操作 UI 入口失效）')
    }
  }
  await page.mouse.move(10, 10) // 移开鼠标收起浮层
  await page.waitForTimeout(300)

  // 入口 2：right bar（能弹菜单但 toolList.right 只有行操作，无列项）
  await hoverRightOfCell(page, 1)
  const rightBarShown = await page.locator(DRAG_BAR).isVisible().catch(() => false)
  if (!rightBarShown) {
    problems.push('hover 单元格右缘未出现表格拖拽条（right bar）')
  } else {
    const menuOpened = await clickDragBar(page)
    if (!menuOpened) {
      problems.push('点击 right 拖拽条后行/列菜单未弹出')
    } else {
      const menuText = await page.locator(ROWCOL_MENU).innerText()
      // eslint-disable-next-line no-console
      console.log('[B07-01] right 菜单项:', JSON.stringify(menuText))
      if (!/insert\s*column/i.test(menuText)) {
        problems.push('行/列菜单中不存在列插入项（toolList.right 仅含 Insert Row Above/Below / Remove Row）')
      }
      // 若菜单恰好有列项（未来修复），尝试点击并校验结果
      const colItem = page.locator(`${ROWCOL_MENU} li`).filter({ hasText: /insert\s*column/i })
      if ((await colItem.count()) > 0) {
        await colItem.first().click()
        await page.waitForTimeout(500)
      }
    }
  }

  // 终态断言：列数应 3 → 4
  const cols = await colCount(page)
  if (cols !== 4) {
    problems.push(`插入列后列数应为 4，实际 ${cols}（UI 层无可用列插入入口 = B07 复现）`)
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B07-01 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B07-02: 插入行后 Ctrl+Z 可撤销、Ctrl+Y 重做', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\table-demo.md', TABLE_DOC)
  await expect(firstTable(page)).toBeVisible({ timeout: 15000 })
  const before = await rowCount(page)
  expect(before).toBe(3)

  // UI 路径：right bar → Insert Row Below
  await hoverRightOfCell(page, 1)
  let inserted = false
  if (await clickDragBar(page)) {
    const item = page.locator(`${ROWCOL_MENU} li`).filter({ hasText: /insert\s*row\s*below/i })
    if ((await item.count()) > 0) {
      await item.first().click()
      await page.waitForTimeout(500)
      inserted = true
    }
  }
  if (!inserted) {
    // eslint-disable-next-line no-console
    console.log('[B07-02] UI 菜单插入行不可用，回退引擎 API（table.insertRow）验证撤销链')
    await page.evaluate(() => {
      const cell = document.querySelector('.mu-editor table td') as HTMLElement & {
        __MUYA_BLOCK__?: { table: { insertRow(offset: number): unknown } }
      }
      cell?.__MUYA_BLOCK__?.table.insertRow(2)
    })
    await page.waitForTimeout(500)
  }

  const afterInsert = await rowCount(page)
  expect(afterInsert, '插入行后行数应 3 → 4').toBe(4)

  // Ctrl+Z：全局快捷键桥（keyboardShortcuts capture → 150ms 延迟 bus → muya.undo）
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(900)
  const afterUndo = await rowCount(page)
  // eslint-disable-next-line no-console
  console.log('[B07-02] undo 后行数:', afterUndo, '（期望 3）')

  const problems: string[] = []
  // 撤销后的内容证据（无论行数对错都记录，供复现报告引用）
  const mdAfterUndo = await getMarkdown(page)
  // eslint-disable-next-line no-console
  console.log('[B07-02] undo 后 markdown 表格段:\n', mdAfterUndo.split('\n').filter((l) => l.includes('|')).join('\n') || '(无表格行)')
  if (afterUndo !== 3) {
    problems.push(`Ctrl+Z 撤销后行数应为 3，实际 ${afterUndo}（插入行撤销无效 = B07 复现）`)
  } else {
    // 内容逐项一致（容差：序列化可能按列宽补空格）
    if (!/\|\s*a1\s*\|\s*b1\s*\|\s*c1\s*\|/.test(mdAfterUndo)) {
      problems.push('撤销后表格内容丢失数据行 a1/b1/c1')
    }
    if (!/\|\s*a2\s*\|\s*b2\s*\|\s*c2\s*\|/.test(mdAfterUndo)) {
      problems.push('撤销后表格内容丢失数据行 a2/b2/c2')
    }
    // Ctrl+Y 重做恢复 4 行
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(900)
    const afterRedo = await rowCount(page)
    if (afterRedo !== 4) {
      problems.push(`Ctrl+Y 重做后行数应为 4，实际 ${afterRedo}`)
    }
  }
  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B07-02 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})

test('TC-B07-03: 引擎层边界——首/末列插入、连续插入行连续撤销、对齐语法保留', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await openDoc(page, 'C:\\docs\\table-demo.md', TABLE_DOC)
  await expect(page.locator('.mu-editor table')).toHaveCount(2, { timeout: 15000 })

  const problems: string[] = []

  // ① 对齐表格（第 2 个表）：引擎 API 首列/末列各插一列，结构完整 + 对齐标记保留
  await page.evaluate(() => {
    const tables = document.querySelectorAll('.mu-editor table')
    const cell = tables[1]!.querySelector('td') as HTMLElement & {
      __MUYA_BLOCK__?: { table: { insertColumn(offset: number): unknown } }
    }
    const table = cell?.__MUYA_BLOCK__?.table
    if (!table) throw new Error('无法访问第二个表格的 muya block')
    table.insertColumn(0)
    const firstRowCells = tables[1]!.querySelector('tr')!.children.length
    // eslint-disable-next-line no-console
    console.log('[B07-03] insertColumn(0) 后首行单元格数:', firstRowCells)
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const tables = document.querySelectorAll('.mu-editor table')
    const row = tables[1]!.querySelector('tr')!
    const lastCell = row.children[row.children.length - 1] as HTMLElement & {
      __MUYA_BLOCK__?: { table: { insertColumn(offset: number): unknown } }
    }
    lastCell?.__MUYA_BLOCK__?.table.insertColumn(3)
  })
  await page.waitForTimeout(400)
  const alignedTableCols = await page
    .locator('.mu-editor table')
    .nth(1)
    .locator('tr')
    .first()
    .locator('td')
    .count()
  if (alignedTableCols !== 5) {
    problems.push(`对齐表 3 列经首/末各插一列后应为 5 列，实际 ${alignedTableCols}`)
  }
  const md = await getMarkdown(page)
  // 对齐标记语义保留检查（序列化会按列宽补齐 '-'，如 :--- 变 :----，居中为 :------:）：
  // 分隔行需同时含 左对齐(:-+)、居中(:-+:)、右对齐(-+:) 三种形态
  const sepLines = md.split('\n').filter((l) => /\|[\s:|-]+\|/.test(l) && l.includes('-'))
  // eslint-disable-next-line no-console
  console.log('[B07-03] 分隔行:', JSON.stringify(sepLines))
  const alignedSep = sepLines.find((l) => /:\s*-+\s*:/.test(l) && /-+\s*:/.test(l))
  if (!alignedSep) {
    problems.push(`插入列后对齐分隔符丢失（需含 :-+/:-+:/-+: 形态），分隔段: ${sepLines.join(' ⏎ ')}`)
  }

  // ② 第一个表：连续插入 3 行（间隔 > 历史合并窗口，避免 op 被并栈）→ 连续 Ctrl+Z 3 次逐级回退
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const cell = document.querySelector('.mu-editor table td') as HTMLElement & {
        __MUYA_BLOCK__?: { table: { insertRow(offset: number): unknown } }
      }
      cell?.__MUYA_BLOCK__?.table.insertRow(3)
    })
    await page.waitForTimeout(1300)
  }
  const rowsAfter3 = await rowCount(page)
  if (rowsAfter3 !== 6) problems.push(`连续插入 3 行后应为 6 行，实际 ${rowsAfter3}`)

  for (let step = 1; step <= 3; step++) {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(900)
    const rows = await rowCount(page)
    const expected = 6 - step
    // eslint-disable-next-line no-console
    console.log(`[B07-03] 连续撤销第 ${step} 次后行数: ${rows}（期望 ${expected}）`)
    if (rows !== expected) {
      problems.push(`连续撤销第 ${step} 次后行数应为 ${expected}，实际 ${rows}`)
      break
    }
  }

  const fatal = fatalErrors(pageErrors)
  if (fatal.length) problems.push(`致命 JS 错误:\n${fatal.join('\n')}`)

  expect(problems, `TC-B07-03 断言失败:\n- ${problems.join('\n- ')}`).toEqual([])
})
