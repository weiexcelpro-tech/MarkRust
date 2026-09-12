// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';

// 诊断：跨表格整段删除后的"残留物"。
// 场景B：选区从标题开始、结束于表格单元格内 → 单元格必须被清空（网格保留）。
// 场景A：选区完整跨过表格（两端都在表外）→ 整张表必须被移除。

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function findContentByText(muya: Muya, needle: string): Content {
    let found: Nullable<Content> = null;
    muya.editor.scrollPage!.depthFirstTraverse((node) => {
        if (found == null && node.isContent() && (node as Content).text.includes(needle))
            found = node as Content;
    });
    if (found == null)
        throw new Error(`content not found: ${needle}`);
    return found;
}

function stubCrossBlockSelection(
    muya: Muya,
    anchorBlock: Content,
    anchorOffset: number,
    focusBlock: Content,
    focusOffset: number,
) {
    const anchorPath = anchorBlock.path;
    const focusPath = focusBlock.path;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: anchorOffset, block: anchorBlock, path: anchorPath },
        focus: { offset: focusOffset, block: focusBlock, path: focusPath },
        isCollapsed: false,
        isSelectionInSameBlock: false,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

async function cut(muya: Muya): Promise<void> {
    muya.editor.clipboard.cutHandler();
    await new Promise(r => setTimeout(r, 40));
}

const TABLE_DOC = [
    '## 总览',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    '| 总技能数 | 557 |',
    '| Popularity 1K-10K | 78 |',
    '| Popularity 100-999 | 396 |',
    '',
    '结尾段落。',
    '',
].join('\n');

describe('跨表格 cut（残留物回归网）', () => {
    it('场景B：标题→单元格内，spanned 单元格必须清空、网格保留', async () => {
        const muya = bootMuya(TABLE_DOC);
        const heading = findContentByText(muya, '总览');
        const endCell = findContentByText(muya, 'Popularity 1K-10K');

        // 锚点在 "## 总" 后，焦点在 "Popularity" 后
        stubCrossBlockSelection(muya, heading, 3, endCell, 10);
        await cut(muya);

        const md = muya.getMarkdown();
        console.log('[场景B] markdown =', JSON.stringify(md));
        console.log('[场景B] dom innerText =', JSON.stringify(muya.domNode.innerText.slice(0, 200)));

        // 标题保留头部 + 焦点单元格尾部
        expect(md).not.toContain('指标');
        expect(md).not.toContain('总技能数');
        expect(md).not.toContain('557');
        expect(md).toContain('396'); // 选中范围之后的行保留
        expect(md).toContain('1K-10K'); // 焦点单元格尾部并入标题
        // DOM 与 state 一致（无残留）
        expect(muya.domNode.innerText).not.toContain('总技能数');
        expect(muya.domNode.innerText).not.toContain('557');
    });

    it('场景A：选区完整跨过表格，整表移除', async () => {
        const muya = bootMuya(TABLE_DOC);
        const heading = findContentByText(muya, '总览');
        const tail = findContentByText(muya, '结尾段落');

        stubCrossBlockSelection(muya, heading, 3, tail, 2);
        await cut(muya);

        const md = muya.getMarkdown();
        console.log('[场景A] markdown =', JSON.stringify(md));
        console.log('[场景A] dom innerText =', JSON.stringify(muya.domNode.innerText.slice(0, 200)));

        expect(md).not.toContain('指标');
        expect(md).not.toContain('557');
        expect(md).not.toContain('396');
        expect(md).toContain('段落。'); // 焦点之后的尾部并入起始块
        expect(muya.domNode.innerText).not.toContain('总技能数');
    });

    it('场景C（反向）：从单元格内拉到表外段落，起始单元格 DOM 必须同步', async () => {
        const muya = bootMuya(TABLE_DOC);
        // 起点在 "557" 单元格内 offset 1，终点在 "结尾段落。" offset 2
        const startCell = findContentByText(muya, '557');
        const tail = findContentByText(muya, '结尾段落');

        stubCrossBlockSelection(muya, startCell, 1, tail, 2);
        await cut(muya);

        const md = muya.getMarkdown();
        console.log('[场景C] markdown =', JSON.stringify(md));
        console.log('[场景C] dom innerText =', JSON.stringify(muya.domNode.innerText.slice(0, 260)));

        // state：起始单元格持有 5 + 段落。 ；选中的 57 尾、其上的指标/总技能数行保持
        expect(md).toContain('5段落');
        expect(md).not.toContain('557');
        // DOM 与 state 一致：选中的 "57" 不得残留在单元格 DOM 里
        // （指标/总技能数行在选区之外，必须原样保留）
        expect(muya.domNode.innerText).not.toContain('557');
    });
});
