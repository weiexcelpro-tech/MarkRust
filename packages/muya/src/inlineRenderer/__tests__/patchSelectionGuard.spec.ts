// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// Regression guard for the search-focus steal: a no-cursor patch of a block
// that the selection does NOT currently own must never write the document
// selection (apply-immediate). Before the guard, a lazy-render patch (fired by
// the IntersectionObserver right after the search reveal scrolled the view)
// collapsed the document selection into the freshly rendered block — stealing
// focus from the search input mid-typing.

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

function contentBlocks(muya: Muya) {
    const blocks: any[] = [];
    muya.editor.scrollPage!.depthFirstTraverse((b: any) => {
        if (b.isContent())
            blocks.push(b);
    });
    return blocks;
}

describe('inlineRenderer.patch — no-cursor patch must not steal the document selection', () => {
    it('no-cursor patch of a cursor-edited block keeps an external selection in place', () => {
        const muya = bootMuya('alpha paragraph\n\nbeta paragraph\n');
        const [first, second] = contentBlocks(muya);

        // Cursor patch on the first block — sets the K5 desired offsets.
        first.setCursor(3, 3, true);
        const sel = document.getSelection()!;
        expect(first.domNode!.contains(sel.anchorNode)).toBe(true);

        // The user now focuses something outside the editor (the search input).
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        expect(document.activeElement).toBe(input);

        // A no-cursor patch of the cursor-edited block (what the search
        // highlight / lazy render path does) must not move the selection back.
        first.update();

        expect(document.activeElement).toBe(input);
        expect(first.domNode!.contains(document.getSelection()!.anchorNode)).toBe(false);
    });

    it('cursor patch still applies the selection (typing path unaffected)', () => {
        const muya = bootMuya('alpha paragraph\n\nbeta paragraph\n');
        const [first] = contentBlocks(muya);

        first.setCursor(5, 5, true);
        const sel = document.getSelection()!;
        expect(first.domNode!.contains(sel.anchorNode)).toBe(true);
    });
});
