// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { loadedLanguages, transformAliasToOrigin } from '../loadLanguage';
import { loadLanguage } from '../index';

// 回归（B07-2 验证链路附带修复）：prismjs 语言组件按需加载曾用
// 「带变量的模板字符串动态导入 + 上游仓库的相对深度」，在本工作区里
// ① 指向不存在的 packages/muya/node_modules（prismjs 实际在仓库根
// node_modules），② Vite/vitest 无法静态解析变量动态导入 —— dev 冷缓存
// 依赖再优化时 esbuild 扫描报错使 dev server 退出（e2e 全挂的原因），
// vitest 下则产生海量 "Unknown variable dynamic import" 未处理拒绝。
// 修复后 import.meta.glob 静态登记语言组件、按需懒加载，本用例验证
// 加载真实生效（非静态内置的 yaml 语言能被加载并进 loadedLanguages）。

describe('prism language loading via import.meta.glob', () => {
    it('resolves the alias to the origin language', () => {
        expect(transformAliasToOrigin(['yml', 'javascript'])).toEqual(['yaml', 'javascript']);
    });

    it('loads a language component that is not statically bundled', async () => {
        const wasLoaded = loadedLanguages.has('yaml');
        await loadLanguage('yaml');
        expect(loadedLanguages.has('yaml') || wasLoaded).toBe(true);
    });
});
