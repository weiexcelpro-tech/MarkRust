// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import HtmlToMarkdown from '../../state/htmlToMarkdown';
import { normalizePastedTable } from '../paste';

// B04 回归：Excel 复制产物（<colgroup> + 无 thead 的裸 <tr>）粘贴后生成
// 「空表头行 + 分隔行」，真实表头降级为首条数据行。
// 根因：normalizePastedHTML 把首行单元格 td→th 后，该行仍在 <tbody> 内，
// 且 tbody 前有 <colgroup>/空白节点 —— turndown-plugin-gfm 的 isHeadingRow
// 只认 THEAD 行或「TABLE/首个 tbody 的直接首行」，于是整表判不出表头行，
// 插件在 rules.table 里补出一行空表头。
// 修复：normalizePastedTable 把首行提升为真正的 <thead>（保留既有 td→th
// 转换），让 GFM 插件经 THEAD 分支识别表头。
//
// 注：本用例直接驱动 normalizePastedTable —— 完整 normalizePastedHTML 管线
// 在 happy-dom 下会被 DOMPurify 解析差异剥掉 <table> 标签（jsdom 环境的
// 既有 spec 覆盖完整管线）；端到端粘贴由 e2e TC-B04-01 在 Chromium 验证。

// F-05-A：Excel 真实复制产物形态（与 tests/e2e/bugs/bug04-excel-paste.spec.ts 一致）
const EXCEL_HTML
    = '<table border=0 cellpadding=0 cellspacing=0 width=192>'
    + '<colgroup><col width=64 span=3></colgroup>'
    + '<tr height=18><td x:str>姓名</td><td x:str>数量</td><td x:str>备注</td></tr>'
    + '<tr><td x:str>张三</td><td x:num>3</td><td></td></tr>'
    + '<tr><td x:str>李四</td><td x:num>5</td><td x:str>ok</td></tr>'
    + '</table>';

function tableOf(html: string): HTMLTableElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const table = wrapper.querySelector('table');
    if (!table)
        throw new Error('fixture has no table');
    return table as HTMLTableElement;
}

function toMarkdown(html: string): string {
    const table = tableOf(html);
    normalizePastedTable(table);
    // 与粘贴管线一致：把规范化后的表格 HTML 交给 turndown GFM 转换。
    return new HtmlToMarkdown({ bulletListMarker: '-' }).generate(table.outerHTML);
}

function pipeLines(md: string): string[] {
    return md.split('\n').filter(l => l.includes('|'));
}

describe('Excel HTML paste → GFM table header (B04)', () => {
    it('promotes the first data row to the header row (no empty header)', () => {
        const lines = pipeLines(toMarkdown(EXCEL_HTML));

        // 首个管道行必须是真表头「姓名 | 数量 | 备注」，不得是空表头。
        expect(lines[0]).toMatch(/\|\s*姓名\s*\|\s*数量\s*\|\s*备注\s*\|/);
        // 第二行是分隔行，随后是数据行；表头不重复出现。
        expect(lines[1]).toMatch(/\|\s*-{3,}\s*\|\s*-{3,}\s*\|\s*-{3,}\s*\|/);
        expect(lines).toHaveLength(4);
        // 表头行不得是空表头（不含「| |」形态的空单元格）。
        expect(lines[0]).not.toMatch(/\|\s*\|/);
        expect(toMarkdown(EXCEL_HTML)).toContain('张三');
        expect(toMarkdown(EXCEL_HTML)).toContain('李四');
    });

    it('keeps tables that already have a thead intact', () => {
        const lines = pipeLines(toMarkdown(
            '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
            + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
        ));
        expect(lines[0]).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
        expect(lines).toHaveLength(3);
    });

    it('handles a first header row inside an explicit tbody (whitespace siblings)', () => {
        const lines = pipeLines(toMarkdown(
            '<table>\n  <tbody>\n    <tr><td>姓名</td><td>数量</td></tr>\n'
            + '    <tr><td>张三</td><td>3</td></tr>\n  </tbody>\n</table>',
        ));
        expect(lines[0]).toMatch(/\|\s*姓名\s*\|\s*数量\s*\|/);
        expect(lines).toHaveLength(3);
    });

    it('keeps the colspan expansion + first-row promotion order stable', () => {
        // colspan=2 首行 + 数据行：先展开占位列再提升表头，首行应得 3 个 th。
        const table = tableOf(
            '<table><tr><td colspan="2">合并</td><td>C</td></tr>'
            + '<tr><td>a</td><td>b</td><td>c</td></tr></table>',
        );
        normalizePastedTable(table);
        const firstRow = table.querySelector('thead tr') ?? table.querySelector('tr');
        expect(firstRow!.children).toHaveLength(3);
        expect(firstRow!.children[0]!.tagName).toBe('TH');
    });
});
