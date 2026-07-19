import type { IEvent, IListeners, Listener } from './types';

// TODO: @Jocs use the same name function in utils.
function* uniqueIdGenerator() {
    let id = 0;

    while (true)
        yield id++;
}
const PREFIX = 'event-';
const idIterator = uniqueIdGenerator();

// O(1) dedup key: target 引用 + event 名 + capture 标志，组合成 string key。
// 解决原 `_checkHasBind` 线性遍历 events 数组导致的 O(N²) boot 性能问题：
// 每个 block 注册 ~8 个 DOM 事件，N 个 block 总注册 O(N²) 次检查。
type TargetLike = HTMLElement | Document;

function eventKey(target: TargetLike, event: string, capture: boolean | AddEventListenerOptions | undefined): string {
    // capture 可能是 boolean 或 AddEventListenerOptions；用稳定序列化
    let captureFlag: boolean;
    if (capture === undefined) {
        captureFlag = false;
    }
    else if (typeof capture === 'boolean') {
        captureFlag = capture;
    }
    else {
        captureFlag = !!capture.capture;
    }
    // target 的稳定 id：DOM 节点用 _muyaEventId（首次访问时打标），Document 用固定字面量
    let targetId: string;
    if (target === document) {
        targetId = '#document';
    }
    else {
        const el = target as HTMLElement & { _muyaEventId?: string };
        if (el._muyaEventId === undefined) {
            el._muyaEventId = `t${idIterator.next().value}`;
        }
        targetId = el._muyaEventId;
    }
    return `${targetId}|${event}|${captureFlag ? 1 : 0}`;
}

class EventCenter {
    public events: IEvent[] = [];
    public listeners: IListeners = {};

    private _dedupIndex: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

    private get _eventId() {
        return `${PREFIX}${idIterator.next().value}`;
    }

    /**
     * [attachDOMEvent] bind event listener to target, and return a unique ID,
     * this ID
     */
    attachDOMEvent(
        target: HTMLElement | Document,
        event: string,
        listener: EventListener,
        capture?: boolean | AddEventListenerOptions,
    ): string {
        if (this._checkHasBind(target, event, listener, capture))
            return '';

        const eventId = this._eventId;
        target.addEventListener(event, listener, capture);
        this.events.push({
            eventId,
            target,
            event,
            listener,
            capture,
        });

        const key = eventKey(target, event, capture);
        let set = this._dedupIndex.get(key);
        if (set === undefined) {
            set = new Set();
            this._dedupIndex.set(key, set);
        }
        set.add(listener);

        return eventId;
    }

    /**
     * [detachDOMEvent removeEventListener]
     * @param  {[type]} eventId [unique eventId]
     */
    detachDOMEvent(eventId: string) {
        if (!eventId)
            return false;

        const removeEvent = this.events.find(e => e.eventId === eventId);
        if (removeEvent) {
            const { target, event, listener, capture } = removeEvent;
            target.removeEventListener(event, listener, capture);
            const index = this.events.findIndex(e => e.eventId === eventId);
            this.events.splice(index, 1);
            this._dedupIndex.get(eventKey(target, event, capture))?.delete(listener as EventListenerOrEventListenerObject);
        }
    }

    /**
     * [detachAllDomEvents remove all the DOM events handler]
     */
    detachAllDomEvents() {
        for (const removedEvent of this.events) {
            const { target, event, listener, capture } = removedEvent;
            target.removeEventListener(event, listener, capture);
        }

        this.events = [];
        this._dedupIndex.clear();
    }

    /**
     * inner method for on and once
     */
    subscribe(event: string, listener: Listener, once = false) {
        const listeners = this.listeners[event];
        const handler = { listener, once };
        if (listeners && Array.isArray(listeners))
            listeners.push(handler);
        else
            this.listeners[event] = [handler];
    }

    /**
     * [on] on custom event
     */
    on(event: string, listener: Listener) {
        this.subscribe(event, listener);
    }

    /**
     * [off] off custom event
     */
    off(event: string, listener: Listener) {
        const listeners = this.listeners[event];
        if (
            Array.isArray(listeners)
            && listeners.some(l => l.listener === listener)
        ) {
            const index = listeners.findIndex(l => l.listener === listener);
            listeners.splice(index, 1);
        }
    }

    /**
     * [once] subscribe event and listen once
     */
    once(event: string, listener: Listener) {
        this.subscribe(event, listener, true);
    }

    /**
     * emit custom event
     */
    emit(event: string, ...data: unknown[]) {
        const eventListener = this.listeners[event];

        if (eventListener && Array.isArray(eventListener)) {
            // Snapshot before iterating: a once-listener removes itself via
            // off() during emit, which mutates the same array and causes
            // forEach to skip the adjacent element. Iterate a copy instead.
            eventListener.slice().forEach(({ listener, once }) => {
                listener(...data);
                if (once)
                    this.off(event, listener);
            });
        }
    }

    /**
     * Remove all pub/sub subscriptions. Called from muya.destroy() to
     * release listener closures so the host page can GC the Muya instance.
     */
    unsubscribeAll() {
        this.listeners = {};
    }

    // Determine whether the event has been bind — O(1) via dedup index
    private _checkHasBind(
        cTarget: HTMLElement | Document,
        cEvent: string,
        cListener: EventListenerOrEventListenerObject,
        cCapture?: boolean | AddEventListenerOptions,
    ) {
        const key = eventKey(cTarget, cEvent, cCapture);
        return this._dedupIndex.get(key)?.has(cListener) ?? false;
    }
}

export default EventCenter;
