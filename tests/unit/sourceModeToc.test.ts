/**
 * findMarkdownHeadingLine — source-mode TOC → CodeMirror line resolution.
 *
 * The critical regression: a leading YAML/TOML/JSON front-matter block must be
 * skipped, because muya's getTOC (block-level parse) never lists front matter,
 * while the old regex counted the closing `---` as a setext heading — shifting
 * every TOC entry by one position (clicking entry N landed on heading N-1).
 */
import { describe, expect, it } from 'vitest'
import { findMarkdownHeadingLine, measureSourceContentOffset, snapSourceLineToTop } from '../../src/renderer/src/util/sourceModeToc'

describe('findMarkdownHeadingLine — 无 front matter（基线）', () => {
  const md = ['# A', '', 'para', '', '# B', '', 'para'].join('\n')

  it('第 N 个标题映射到正确行号', () => {
    expect(findMarkdownHeadingLine(md, 0)).toBe(0)
    expect(findMarkdownHeadingLine(md, 1)).toBe(4)
  })

  it('索引越界返回 -1；负索引返回 -1', () => {
    expect(findMarkdownHeadingLine(md, 2)).toBe(-1)
    expect(findMarkdownHeadingLine(md, -1)).toBe(-1)
  })
})

describe('findMarkdownHeadingLine — YAML front matter（回归核心）', () => {
  // Old bug: closing `---` (line 3) matched the setext-underline regex, so
  // heading 0 resolved to line 3 (front matter end) and heading N to heading
  // N-1's line.
  const md = ['---', 'title: T', 'draft: false', '---', '', '# A', '', 'para', '', '# B'].join('\n')

  it('跳过 front matter，标题 0 落在真实标题行', () => {
    expect(findMarkdownHeadingLine(md, 0)).toBe(5)
  })

  it('标题 N 不再错位到标题 N-1', () => {
    expect(findMarkdownHeadingLine(md, 1)).toBe(9)
    expect(findMarkdownHeadingLine(md, 2)).toBe(-1)
  })

  it('YAML `...` 结束符同样跳过', () => {
    const mdDots = ['---', 'title: T', '...', '', '# A'].join('\n')
    expect(findMarkdownHeadingLine(mdDots, 0)).toBe(4)
  })
})

describe('findMarkdownHeadingLine — TOML / JSON front matter', () => {
  it('TOML +++ 块被跳过', () => {
    const mdToml = ['+++', 'title = "T"', '+++', '', '# A', '', '# B'].join('\n')
    expect(findMarkdownHeadingLine(mdToml, 0)).toBe(4)
    expect(findMarkdownHeadingLine(mdToml, 1)).toBe(6)
  })

  it('JSON ;;; 块被跳过', () => {
    const mdJson = [';;;', '"title": "T"', ';;;', '', '# A'].join('\n')
    expect(findMarkdownHeadingLine(mdJson, 0)).toBe(4)
  })
})

describe('findMarkdownHeadingLine — 伪 front matter（不应跳过）', () => {
  it('开头 --- 无闭合标记时视为 thematic break，不跳过', () => {
    const mdBreak = ['---', '', '# A'].join('\n')
    expect(findMarkdownHeadingLine(mdBreak, 0)).toBe(2)
  })

  it('front matter 不在首行时不跳过（title 行按 setext 规则成头）', () => {
    const mdLate = ['', '---', 'title: T', '---', '', '# A'].join('\n')
    // Front matter must start at line 0; here it doesn't, so per CommonMark
    // `title: T` + `---` IS a setext H2 at line 2 — same as muya parses it.
    expect(findMarkdownHeadingLine(mdLate, 0)).toBe(2)
  })
})

describe('findMarkdownHeadingLine — 嵌套围栏（AI 对话导出格式，真实回归）', () => {
  it('4 反引号外层包裹 3 反引号内层：内层 ``` 不得关闭外层围栏', () => {
    // 真实病例：AI 对话导出用 ````markdown 包裹 ``` 代码块，旧实现的
    // "同字符即关闭"让内层 ``` 提前关闭外层，围栏状态机错乱，
    // 之后 28 个真标题全部被当代码跳过 → 源码 TOC 全部 -1。
    const md = [
      '前言',
      '',
      '````markdown',
      '# 假标题（围栏内）',
      '',
      '```js',
      'console.log(1)',
      '```',
      '',
      '## 另一个假标题（围栏内）',
      '````',
      '',
      '# 真标题 A',
      '',
      '## 真标题 B',
    ].join('\n')
    expect(findMarkdownHeadingLine(md, 0)).toBe(12)
    expect(findMarkdownHeadingLine(md, 1)).toBe(14)
    expect(findMarkdownHeadingLine(md, 2)).toBe(-1)
  })

  it('关闭围栏长度必须 ≥ 开启围栏长度', () => {
    const md = [
      '```python',
      '# 注释（围栏内）',
      '````', // 4 反引号是本围栏的合法关闭（≥3）——先开先关语义下仍关闭
      '',
      '# 真标题',
    ].join('\n')
    expect(findMarkdownHeadingLine(md, 0)).toBe(4)
  })

  it('关闭围栏行后不得有文字（否则不是关闭）', () => {
    const md = [
      '```text',
      '# 围栏内标题',
      '``` 不是关闭行（尾随文字）',
      '',
      '# 围栏后的真标题',
    ].join('\n')
    // 围栏未关闭，'# 围栏后的真标题' 仍在围栏内 → 无标题
    expect(findMarkdownHeadingLine(md, 0)).toBe(-1)
  })
})

describe('findMarkdownHeadingLine — 既有行为回归（围栏/setext）', () => {
  it('代码围栏内的 # 不算标题', () => {
    const md = ['# A', '', '```', '# not a heading', '```', '', '# B'].join('\n')
    expect(findMarkdownHeadingLine(md, 0)).toBe(0)
    expect(findMarkdownHeadingLine(md, 1)).toBe(6)
  })

  it('setext 标题（下划线 ===/---）算标题', () => {
    const md = ['Title A', '===', '', 'Para', '', 'Title B', '---', '', 'x'].join('\n')
    expect(findMarkdownHeadingLine(md, 0)).toBe(0)
    expect(findMarkdownHeadingLine(md, 1)).toBe(5)
  })
})


describe('snapSourceLineToTop — 落点漂移校正', () => {
  type EditorArg = Parameters<typeof snapSourceLineToTop>[0]
  const makeEditor = (charTop: number): EditorArg =>
    ({ charCoords: () => ({ top: charTop, bottom: charTop + 20, left: 0, right: 100 }) }) as unknown as EditorArg
  const makeContainer = (scrollTop: number): HTMLElement =>
    ({
      scrollTop,
      getBoundingClientRect: () => ({ top: 100, left: 0, right: 800, bottom: 500, width: 800, height: 400 }),
    }) as unknown as HTMLElement

  it('偏差 > 1px：按 charCoords 实测差值瞬时校正', () => {
    const c = makeContainer(1000)
    snapSourceLineToTop(makeEditor(114), 5, c) // delta = 114 - 100 = 14
    expect(c.scrollTop).toBe(1014)
  })

  it('负偏差（落点偏下）同样校正', () => {
    const c = makeContainer(1000)
    snapSourceLineToTop(makeEditor(72), 5, c) // delta = -28
    expect(c.scrollTop).toBe(972)
  })

  it('|偏差| <= 1px：不写入 scrollTop', () => {
    const c = makeContainer(1000)
    snapSourceLineToTop(makeEditor(100.6), 5, c)
    expect(c.scrollTop).toBe(1000)
  })

  it('容器为 null 时安全返回', () => {
    expect(() => snapSourceLineToTop(makeEditor(100), 0, null)).not.toThrow()
  })
})

describe('measureSourceContentOffset — 内容偏移实测（替代硬编码 +50）', () => {
  it('按 .CodeMirror wrapper 实测：视口差 + scrollTop', () => {
    const wrapper = { getBoundingClientRect: () => ({ top: 150 }) }
    const container = {
      scrollTop: 40,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (sel: string) => (sel === '.CodeMirror' ? wrapper : null),
    } as unknown as HTMLElement
    expect(measureSourceContentOffset(container)).toBe(90)
  })

  it('找不到 wrapper 时回退 50（历史 margin 值）', () => {
    const container = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelector: () => null,
    } as unknown as HTMLElement
    expect(measureSourceContentOffset(container)).toBe(50)
  })
})
