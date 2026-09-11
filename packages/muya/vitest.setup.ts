/**
 * Vitest setup for the muya package: install a deterministic
 * IntersectionObserver mock so Content blocks take the REAL lazy-render path
 * (`_scheduleLazyPatch` → observe → callback → update) in unit tests instead
 * of the eager fallback (happy-dom has no IO, so without this polyfill the
 * lazy path was never exercised by any unit test — the search × lazy-render
 * interaction bugs shipped through exactly that blind spot).
 *
 * The mock fires the callback SYNCHRONOUSLY on observe() with
 * isIntersecting: true — every block renders exactly as before (no test
 * timing changes), but through the lazy state machine.
 */
export {}

type IOCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

class MockIntersectionObserver {
    static observed: Array<{ el: Element; io: MockIntersectionObserver }> = []

    private cb: IOCallback
    private disconnected = false

    constructor(cb: IOCallback) {
        this.cb = cb
    }

    observe(el: Element): void {
        if (this.disconnected) return
        MockIntersectionObserver.observed.push({ el, io: this })
        // Synchronous fire: the block renders immediately, through the lazy
        // state machine (callback stamps the flag and calls update()).
        this.cb([{ isIntersecting: true, target: el }])
    }

    unobserve(): void {}

    disconnect(): void {
        this.disconnected = true
    }

    takeRecords(): Array<unknown> {
        return []
    }
}

;(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver
