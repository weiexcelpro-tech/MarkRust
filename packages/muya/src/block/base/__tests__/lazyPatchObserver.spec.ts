// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// Locks the IntersectionObserver polyfill contract (vitest.setup.ts): unit
// tests must exercise the REAL lazy-render path — blocks are scheduled via
// IntersectionObserver (sync fire) instead of the eager fallback. Every lazy
// regression (search × lazy, flush × lazy) now runs this path in every unit
// test; this spec fails if the polyfill stops being installed or the blocks
// stop going through it.

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
    const muya = new Muya(host, { markdown, lazyInlineRender: true } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('lazy patch — IntersectionObserver path active under the vitest setup', () => {
    it('blocks created after boot go through IntersectionObserver.observe', () => {
        const muya = bootMuya('# head\n\npara one\n\npara two\n');
        // Boot-time blocks take the eager path on purpose: scrollPage is not
        // attached yet during boot (see _isLazyPatchEligible). Blocks created
        // AFTER boot — the state every edit/scroll-time block lives in — must
        // take the lazy path.
        (globalThis as any).IntersectionObserver.observed.length = 0;
        muya.setContent('# head\n\npara one\n\npara two\n\npara three\n');

        const observed = (globalThis as any).IntersectionObserver.observed as Array<{ el: Element }>;
        expect(observed.length, '重建后的块必须注册 IntersectionObserver（懒渲染路径）').toBeGreaterThan(0);
        // IO observes the content block's own domNode (inner span), not the
        // outer <p> — assert by content.
        const observedText = observed.map((o) => o.el.textContent || '').join('\n');
        expect(observedText).toContain('para three');
    });

    it('sync-fire patched the blocks: content rendered and lazy flag stamped', () => {
        const muya = bootMuya('# head\n\npara with body text\n');
        const para = [...muya.domNode.querySelectorAll('p, [data-id]')]
            .find((el) => el.textContent!.includes('para with body text'))!;
        expect(para.textContent).toContain('para with body text');

        const blocks: any[] = [];
        muya.editor.scrollPage!.depthFirstTraverse((b: any) => {
            if (b.isContent())
                blocks.push(b);
        });
        const target = blocks.find((b) => String(b.text).includes('para with body text'))!;
        expect(target._lazyPatched).toBe(true);
    });
});
