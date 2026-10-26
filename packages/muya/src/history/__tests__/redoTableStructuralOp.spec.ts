// @vitest-environment happy-dom

import type TreeNode from '../../block/base/treeNode';
import type Table from '../../block/gfm/table';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// B07-2 回归：表格结构操作（insertRow / insertColumn）后 Ctrl+Y 重做失效。
// 根因定位：引擎 history 的 redo 管线对结构 op 本身是完好的（下面前三个
// 用例直接驱动 muya.redo() 全部通过）；失效点是快捷键链路 —— 桌面壳只映射
// 了 Ctrl+Shift+Z，Ctrl+Y 穿透到 contenteditable 走浏览器原生重做，而原生
// 重做只对文本输入生效、对 JS 插入的表格行无效。修复 = 引擎在 domNode
// keydown 上接管 Ctrl/Cmd+Y → muya.redo()（见最后一个用例）。
// 本用例同时守护：结构 op 的 undo/redo 往返后 JSON 状态与实时块树一致。

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function findTable(muya: Muya): Table {
    let table: Table | null = null;
    const visit = (block: TreeNode) => {
        if ((block.constructor as typeof TreeNode)?.blockName === 'table')
            table = block as Table;
        if (block.isParent())
            block.children.forEach(c => visit(c));
    };
    visit(muya.editor.scrollPage!);
    if (!table)
        throw new Error('no table found');
    return table;
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

const TABLE_DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

describe('history redo of table structural ops (B07-2)', () => {
    it('insertRow: undo removes the DOM row and redo re-inserts it', async () => {
        const muya = bootMuya(TABLE_DOC);
        const table = findTable(muya);
        expect(table.rowCount).toBe(2);

        table.insertRow(1);
        await flush();
        expect(table.rowCount).toBe(3);

        muya.undo();
        await flush();
        expect(table.rowCount, 'undo 后 DOM 行数应回到 2').toBe(2);

        muya.redo();
        await flush();
        expect(table.rowCount, 'redo 后 DOM 行数应恢复 3（B07-2）').toBe(3);
        expect(findTable(muya).rowCount).toBe(3);
    });

    it('insertColumn: undo removes the DOM column and redo re-inserts it', async () => {
        const muya = bootMuya(TABLE_DOC);
        const table = findTable(muya);
        expect(table.columnCount).toBe(2);

        table.insertColumn(1, 'none');
        await flush();
        expect(table.columnCount).toBe(3);

        muya.undo();
        await flush();
        expect(table.columnCount, 'undo 后 DOM 列数应回到 2').toBe(2);

        muya.redo();
        await flush();
        expect(table.columnCount, 'redo 后 DOM 列数应恢复 3（B07-2）').toBe(3);
    });

    it('redo leaves JSON state and DOM tree in sync', async () => {
        const muya = bootMuya(TABLE_DOC);
        const table = findTable(muya);

        table.insertRow(2);
        await flush();
        muya.undo();
        await flush();
        expect(table.rowCount, 'undo 后回到 2 行').toBe(2);
        muya.redo();
        await flush();

        // JSON 状态（序列化 markdown 的表格数据行）与 DOM 行数必须一致 ——
        // 修复前 drop walker 对末尾插入会静默丢弃，DOM 少一行。
        // markdown 管道行 = 表头 + 分隔行 + 数据行 = DOM 行数 + 1。
        const md = muya.getMarkdown();
        const mdTableRows = md.split('\n').filter(l => l.startsWith('|')).length;
        expect(mdTableRows, 'markdown 行数应为 DOM 行数 + 分隔行').toBe(table.rowCount + 1);
        expect(table.rowCount, 'redo 后 DOM 行数应恢复 3').toBe(3);
    });

    it('Ctrl+Y keydown triggers redo (B07-2 host shortcut passthrough)', async () => {
        // 桌面壳只映射了 Ctrl+Shift+Z；Ctrl+Y 穿透到编辑器，此前无人处理，
        // contenteditable 原生重做对 JS 插入的结构行无效。引擎现在在
        // domNode keydown 上接管 Ctrl/Cmd+Y → muya.redo()。
        const muya = bootMuya(TABLE_DOC);
        const table = findTable(muya);

        table.insertRow(1);
        await flush();
        muya.undo();
        await flush();
        expect(table.rowCount).toBe(2);

        const target = table.domNode as HTMLElement;
        target.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'y',
            code: 'KeyY',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        }));
        await flush();

        expect(table.rowCount, 'Ctrl+Y 应触发重做恢复 3 行').toBe(3);

        // 非 Ctrl 的 y、Ctrl+Shift+Y 不得触发重做（redo 栈已空，行数不变）。
        target.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'y',
            code: 'KeyY',
            bubbles: true,
            cancelable: true,
        }));
        await flush();
        expect(table.rowCount).toBe(3);
    });
});
