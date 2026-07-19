import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { IHighlight, Labels } from './types';
import logger from '../utils/logger';
import { tokenizer } from './lexer';
import Renderer from './renderer';
import { beginRules } from './rules';
import { CLASS_NAMES } from '../config';
import { isElement } from '../utils';

const debug = logger('inlineRenderer:');

// === K V6.1: 光标漂移修复（domNode.innerHTML 全量重写导致归一化覆盖 selection）===
//
// 根因：patch() 内 `domNode.innerHTML = html` 销毁旧 TextNode，浏览器约 41ms 后
// 异步归一化 selection 到段首（SPAN@0 等元素节点），导致后续输入插错位置。
// 表现：空段输入 `#test` → 得到 `#tste`（字符错乱 bug）。
// 同源：marktext#1911（task-list 已修），atx heading 等块转换未修。
//
// K V5 → K V6 → K V6.1 演进：
//   K V5：CDP 测试成功，真实键盘失败。根因：input 事件 handler 让 guard 立即退出，
//         无法抵抗 ~41ms 归一化覆盖。
//   K V6：删除 input 退出逻辑 + 500ms guard + `desired+1` 精确检查反归一化。
//         用例 1-8 通过，用例 9（极快连打 #test12345）失败 → #tt12345es。
//         根因：极快输入时两帧间插入 2+ 字符，`desired+1` 精确检查误判为异常偏移，
//         强制恢复把光标拉回，导致字符顺序错乱。
//   K V6.1：把 `desired+1` 精确检查改为方向判断：
//         - Element 节点 → 强制恢复（归一化特征）
//         - TextNode 向前移动（>= desired）→ 更新 desired 跟进（兼容极快多字符）
//         - TextNode 向后跳（< desired）→ 强制恢复（归一化特征）
//
// K V6.1 修复策略：
//   1. **完全删除 input 事件退出逻辑**（旧 guard 会被新 patch 的 K5_GUARD_ID 自增
//      机制自然覆盖失效，不需要 input 退出）
//   2. patch 后立即同步设 sel 到 desired（apply-immediate）
//   3. rAF guard 持续 500ms 守护归一化窗口（覆盖 ~41ms 归一化 + 真实键盘连续输入）
//   4. **方向判断反归一化策略**（见上）
//   5. desired 只来自 hasCursor patch（不被 savedSel 归一化污染）
//   6. 每帧重新 find TextNode（防 no-cursor patch 销毁 TextNode）
const K5_GUARD_MS = 500;
const K5_DESIRED_FOCUS = '_k5DesiredFocus';
const K5_DESIRED_ANCHOR = '_k5DesiredAnchor';
const K5_DESIRED_COLLAPSED = '_k5DesiredCollapsed';
const K5_GUARD_ID = '_k5GuardId';

interface ITextNodeOffset { textNode: Text; localOffset: number }

function k5GetTextContentLen(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE)
        return (node.nodeValue || '').length;
    if (isElement(node)) {
        const cn = node.className || '';
        if (cn.includes(CLASS_NAMES.MU_MATH_RENDER) || cn.includes(CLASS_NAMES.MU_RUBY_RENDER))
            return 0;
        let len = 0;
        for (let i = 0; i < node.childNodes.length; i++)
            len += k5GetTextContentLen(node.childNodes[i]);
        return len;
    }
    return 0;
}

function k5GetOffsetOfParagraph(node: Node, paragraph: HTMLElement): number {
    if (node === paragraph)
        return 0;
    let offset = 0;
    let preSibling: Node | null = node;
    do {
        preSibling = preSibling.previousSibling;
        if (preSibling)
            offset += k5GetTextContentLen(preSibling);
    } while (preSibling);
    return node === paragraph || node.parentNode === paragraph
        ? offset
        : offset + k5GetOffsetOfParagraph(node.parentNode!, paragraph);
}

function k5FindTextNodeAtOffset(root: Node, targetOffset: number): ITextNodeOffset | null {
    let currentOffset = 0;
    let result: ITextNodeOffset | null = null;
    function walk(node: Node) {
        if (result)
            return;
        if (node.nodeType === Node.TEXT_NODE) {
            const len = (node.nodeValue || '').length;
            if (currentOffset + len >= targetOffset) {
                result = { textNode: node as Text, localOffset: targetOffset - currentOffset };
                return;
            }
            currentOffset += len;
        }
        else if (isElement(node)) {
            const cn = node.className || '';
            if (cn.includes(CLASS_NAMES.MU_MATH_RENDER) || cn.includes(CLASS_NAMES.MU_RUBY_RENDER))
                return;
            const children = node.childNodes;
            for (let i = 0; i < children.length; i++)
                walk(children[i]);
        }
    }
    walk(root);
    return result;
}

// K V6: 反归一化策略辅助函数
// 从 selection.anchorNode + anchorOffset 反推段中总 offset（与 desired 同坐标系）。
// 如果 anchorNode 是 TextNode，返回它在段中的起始 offset + anchorOffset。
// 如果 anchorNode 是 Element，返回它前面兄弟节点的 textContent 累加长度（即元素起点）。
// 用于判断 selection 当前是「归一化覆盖到元素节点」还是「在 TextNode 上自然前进」。
function k5GetCursorOffsetInParagraph(root: HTMLElement, anchorNode: Node, anchorOffset: number): number {
    if (anchorNode.nodeType === Node.TEXT_NODE) {
        return k5GetOffsetOfParagraph(anchorNode, root) + anchorOffset;
    }
    // anchorNode 是 Element：anchorOffset 是子节点索引
    let offset = k5GetOffsetOfParagraph(anchorNode, root);
    if (isElement(anchorNode)) {
        const children = anchorNode.childNodes;
        for (let i = 0; i < anchorOffset && i < children.length; i++)
            offset += k5GetTextContentLen(children[i]);
    }
    return offset;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K5Block = Format & Record<string, any>;

class InlineRenderer {
    public labels: Labels = new Map();
    public renderer: Renderer;

    // Labels cache: PRD 要求 500KB 文档流畅编辑。原 `_collectReferenceDefinitions` 在
    // 每次 patch() 时全文档扫描（O(N)），ScrollPage.create 批量构建 N 个 block 时
    // 每个都触发一次 = O(N²)。引入 dirty flag，state 不变就复用 cache。
    private _labelsDirty = true;

    constructor(public muya: Muya) {
        this.renderer = new Renderer(muya, this);
    }

    /**
     * Mark cached labels as stale. Called by Editor after `json-change` events
     * (any state mutation). Next `patch()` will rebuild the labels map.
     */
    markLabelsDirty(): void {
        this._labelsDirty = true;
    }

    private _tokenizer(block: Format, highlights: IHighlight[]) {
        const { options } = this.muya;
        const { text } = block;
        const { labels } = this;

        // TODO: different content block should have different rules.
        // eg: atxheading.content has no soft|hard line break
        // setextheading.content has no heading rules.
        const hasBeginRules
            = /thematicbreak\.content|paragraph\.content|atxheading\.content/.test(
                block.blockName,
            );

        return tokenizer(text, { hasBeginRules, labels, options, highlights });
    }

    /**
     * Flush every cached image and force inline images to reload.
     *
     * The renderer memoises loaded images in `loadImageMap` (keyed by src,
     * skipped on the next render once `isSuccess` is true) and resolved URLs
     * in `urlMap`. When an image file changes on disk the cached entry would
     * otherwise keep the stale bitmap, so clearing both maps and re-rendering
     * every content block re-runs `loadImageAsync`, which loads the source
     * afresh.
     */
    invalidateImageCache() {
        this.renderer.loadImageMap.clear();
        this.renderer.urlMap.clear();

        const { scrollPage } = this.muya.editor;
        if (!scrollPage)
            return;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                node.update();
        });
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this._collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const k5block = block as K5Block;

        // === K V5: patch 之前记录当前 selection（如果 anchorNode 在 domNode 内）===
        // 仅在无 desired 时作为 fallback 用，desired 永远来自 hasCursor patch 不会被 savedSel 污染
        let savedSel: { anchorOffset: number; focusOffset: number; isCollapsed: boolean } | null = null;
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0 && sel.anchorNode && domNode!.contains(sel.anchorNode)) {
            try {
                const ao = k5GetOffsetOfParagraph(sel.anchorNode, domNode!);
                const fo = sel.isCollapsed ? ao : k5GetOffsetOfParagraph(sel.focusNode!, domNode!);
                savedSel = { anchorOffset: ao, focusOffset: fo, isCollapsed: sel.isCollapsed };
            }
            catch {
                // ignore: 仅用于 fallback，失败则跳过
            }
        }

        const tokens = this._tokenizer(block, highlights);
        const html = this.renderer.output(
            tokens,
            block,
            cursor && cursor.block === block ? cursor : {},
        );

        // ★ 根因操作：domNode.innerHTML = html 销毁旧 TextNode，触发浏览器异步归一化。
        // K V5 在此之后立即同步设 sel 到 desired，并用 120ms rAF guard 守护归一化窗口。
        domNode!.innerHTML = html;

        // === K V5: 选择 desired offset（优先 hasCursor；其次旧 desired；最后 savedSel）===
        const hasCursor = !!(cursor && cursor.block === block && cursor.anchor && cursor.focus);
        let targetAnchorOffset: number;
        let targetFocusOffset: number;

        if (hasCursor) {
            targetAnchorOffset = cursor!.anchor!.offset;
            targetFocusOffset = cursor!.focus!.offset;
            k5block[K5_DESIRED_FOCUS] = targetFocusOffset;
            k5block[K5_DESIRED_ANCHOR] = targetAnchorOffset;
            k5block[K5_DESIRED_COLLAPSED] = targetAnchorOffset === targetFocusOffset;
        }
        else if (k5block[K5_DESIRED_FOCUS] != null) {
            // no-cursor patch：复用旧 desired（不被 savedSel 污染）
            targetAnchorOffset = k5block[K5_DESIRED_ANCHOR];
            targetFocusOffset = k5block[K5_DESIRED_FOCUS];
        }
        else if (savedSel) {
            // 初次进入块的 no-cursor patch：fallback 到 savedSel
            targetAnchorOffset = savedSel.anchorOffset;
            targetFocusOffset = savedSel.focusOffset;
            k5block[K5_DESIRED_FOCUS] = targetFocusOffset;
            k5block[K5_DESIRED_ANCHOR] = targetAnchorOffset;
            k5block[K5_DESIRED_COLLAPSED] = savedSel.isCollapsed;
        }
        else {
            return;
        }

        const isCollapsed = targetAnchorOffset === targetFocusOffset;

        // === K V5: apply-immediate（patch 后立即同步设 sel 到 desired）===
        const foundFocus = k5FindTextNodeAtOffset(domNode!, targetFocusOffset);
        const foundAnchor = isCollapsed ? foundFocus : k5FindTextNodeAtOffset(domNode!, targetAnchorOffset);
        if (foundFocus && foundAnchor && sel) {
            try {
                if (isCollapsed)
                    sel.collapse(foundFocus.textNode, foundFocus.localOffset);
                else
                    sel.setBaseAndExtent(
                        foundAnchor.textNode, foundAnchor.localOffset,
                        foundFocus.textNode, foundFocus.localOffset,
                    );
            }
            catch {
                // ignore: 极端情况下 Selection 操作失败不应阻塞渲染
            }
        }

        // === K V6: rAF guard 500ms 守护归一化窗口 + 反归一化策略 ===
        // K V6 删除了 K V5 的 input 事件退出逻辑（旧 guard 会被新 patch 的 K5_GUARD_ID
        // 自增机制自然覆盖失效，不需要 input 退出；反而 input 退出会让 guard 在真实
        // 键盘连续输入时全部失效，导致归一化覆盖无人抵抗）。
        const guardUntil = performance.now() + K5_GUARD_MS;
        const myId = (k5block[K5_GUARD_ID] || 0) + 1;
        k5block[K5_GUARD_ID] = myId;

        const apply = () => {
            // 守护被新 guard 取代（新 patch 自增 K5_GUARD_ID）
            if (k5block[K5_GUARD_ID] !== myId)
                return;
            // 500ms 到期：让浏览器自然处理后续普通字符
            if (performance.now() > guardUntil)
                return;
            if (k5block[K5_DESIRED_FOCUS] == null)
                return;

            const curSel = document.getSelection();
            if (!curSel || !curSel.anchorNode || !curSel.focusNode) {
                requestAnimationFrame(apply);
                return;
            }
            // selection 离开本块：放弃守护
            if (!domNode!.contains(curSel.anchorNode) || !domNode!.contains(curSel.focusNode)) {
                requestAnimationFrame(apply);
                return;
            }

            const desiredFocus = k5block[K5_DESIRED_FOCUS] as number;
            const desiredAnchor = k5block[K5_DESIRED_ANCHOR] as number;
            const desiredCollapsed = k5block[K5_DESIRED_COLLAPSED] as boolean;

            // === K V6.1: 反归一化策略（方向判断，兼容极快连续输入）===
            // K V6 用 `desired + 1` 精确检查，在极快输入下（两帧间插入 2+ 字符）会误判为
            // 异常偏移并强制恢复，导致光标被拉回、字符顺序错乱（#test12345 → #tt12345es）。
            //
            // K V6.1 改为按方向判断：
            //   - 光标在 Element 节点上 → 归一化特征，强制恢复
            //   - 光标在 TextNode 上且向前移动（>= desired）→ 自然输入，更新 desired 跟进
            //   - 光标在 TextNode 上且向后跳（< desired）→ 归一化特征，强制恢复
            const focusInText = curSel.focusNode.nodeType === Node.TEXT_NODE;
            const anchorInText = desiredCollapsed ? focusInText : (curSel.anchorNode.nodeType === Node.TEXT_NODE);
            const curFocusOffset = k5GetCursorOffsetInParagraph(domNode!, curSel.focusNode, curSel.focusOffset);
            const curAnchorOffset = desiredCollapsed
                ? curFocusOffset
                : k5GetCursorOffsetInParagraph(domNode!, curSel.anchorNode, curSel.anchorOffset);

            let needRestore = false;
            let newDesiredFocus: number | null = null;
            let newDesiredAnchor: number | null = null;

            if (!focusInText) {
                // 光标在 Element 节点（归一化覆盖到 SPAN@0 等）：强制恢复到 desired
                needRestore = true;
            }
            else if (desiredCollapsed) {
                // 折叠选区：按方向判断
                if (curFocusOffset === desiredFocus) {
                    // 在 desired 位置：无需操作
                }
                else if (curFocusOffset > desiredFocus) {
                    // 向前移动（自然输入，可能极快连打多字符）：更新 desired 跟进
                    newDesiredFocus = curFocusOffset;
                    newDesiredAnchor = curFocusOffset;
                }
                else {
                    // 向后跳（curFocusOffset < desiredFocus，归一化特征）：强制恢复
                    needRestore = true;
                }
            }
            else {
                // 非折叠选区：focus 允许向前移动，anchor 必须保持
                if (!anchorInText) {
                    needRestore = true;
                }
                else if (curFocusOffset > desiredFocus && curAnchorOffset === desiredAnchor) {
                    newDesiredFocus = curFocusOffset;
                }
                else if (curFocusOffset < desiredFocus || curAnchorOffset !== desiredAnchor) {
                    needRestore = true;
                }
            }

            // 更新 desired（跟进自然前进，不强制恢复）
            if (newDesiredFocus != null) {
                k5block[K5_DESIRED_FOCUS] = newDesiredFocus;
                if (newDesiredAnchor != null) {
                    k5block[K5_DESIRED_ANCHOR] = newDesiredAnchor;
                    k5block[K5_DESIRED_COLLAPSED] = newDesiredAnchor === newDesiredFocus;
                }
            }

            // 强制恢复（归一化覆盖或异常偏移）
            if (needRestore) {
                const finalFocus = k5block[K5_DESIRED_FOCUS] as number;
                const finalAnchor = k5block[K5_DESIRED_ANCHOR] as number;
                const finalCollapsed = k5block[K5_DESIRED_COLLAPSED] as boolean;
                // 每帧重新 find（防 TextNode 被 no-cursor patch 销毁）
                const nowFoundFocus = k5FindTextNodeAtOffset(domNode!, finalFocus);
                const nowFoundAnchor = finalCollapsed
                    ? nowFoundFocus
                    : k5FindTextNodeAtOffset(domNode!, finalAnchor);
                if (nowFoundFocus && nowFoundAnchor) {
                    try {
                        if (finalCollapsed)
                            curSel.collapse(nowFoundFocus.textNode, nowFoundFocus.localOffset);
                        else
                            curSel.setBaseAndExtent(
                                nowFoundAnchor.textNode, nowFoundAnchor.localOffset,
                                nowFoundFocus.textNode, nowFoundFocus.localOffset,
                            );
                    }
                    catch {
                        // ignore: 单帧恢复失败不影响整体守护
                    }
                }
            }
            requestAnimationFrame(apply);
        };
        requestAnimationFrame(apply);
    }

    private _collectReferenceDefinitions() {
        // 批量构建（如 ScrollPage.create）期间 jsonState 不变，复用 cache 跳过 O(N) 扫描
        if (!this._labelsDirty)
            return;

        const state = this.muya.editor.jsonState.getState();
        const labels = new Map();

        const travel = (sts: TState[]) => {
            if (Array.isArray(sts) && sts.length) {
                for (const st of sts) {
                    if (st.name === 'paragraph') {
                        const { label, info } = this.getLabelInfo(st);
                        if (label && info)
                            labels.set(label, info);
                    }
                    else if ((st as TContainerState).children) {
                        travel((st as TContainerState).children);
                    }
                }
            }
        };

        travel(state);

        this.labels = labels;
        this._labelsDirty = false;
    }

    getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
        const { text } = blockOrState;
        const tokens = beginRules.reference_definition.exec(text);
        let label = null;
        let info = null;
        if (tokens) {
            label = (tokens[2] + tokens[3]).toLowerCase();
            info = {
                href: tokens[6],
                title: tokens[10] || '',
            };
        }

        return { label, info };
    }
}

export default InlineRenderer;
