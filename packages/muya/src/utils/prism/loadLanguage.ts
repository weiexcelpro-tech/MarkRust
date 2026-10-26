import components from 'prismjs/components.js';
import getLoader from 'prismjs/dependencies';
import { getDefer } from '../index';

interface ILangLoadStatus {
    lang: string;
    status: 'noexist' | 'cached' | 'loaded';
}
/**
 * The set of all languages which have been loaded using the below function.
 *
 * @type {Set<string>}
 */
export const loadedLanguages = new Set([
    'markup',
    'css',
    'clike',
    'javascript',
]);

const { languages } = components;

// prismjs 语言组件按需懒加载。旧实现是带变量的模板字符串动态导入
// （`../../../node_modules/prismjs/components/prism-<lang>.js`）：
// ① 路径深度是上游仓库的（包在仓库根/src/muya），迁入 packages/muya 后
//    指向不存在的 packages/muya/node_modules —— 本工作区里 prismjs 实际
//    只在仓库根 node_modules；② Vite/vitest 无法静态解析变量动态导入：
//    dev 冷缓存首次依赖再优化时 esbuild 扫描直接报错使 dev server 退出，
//    vitest 下产生海量 "Unknown variable dynamic import" 未处理拒绝。
// 改用 import.meta.glob 在转换期静态登记根 node_modules 下的全部语言
// 组件（相对本文件的正确深度），按需懒加载；dev/构建/vitest 三态一致。
const prismLanguageLoaders: Record<string, () => Promise<unknown>> = import.meta.glob(
    '../../../../../node_modules/prismjs/components/prism-*.js',
);

async function loadPrismLanguage(lang: string): Promise<void> {
    // glob 的 key 是相对于本文件的模式相对路径，与 pattern 前缀一致。
    const loader
        = prismLanguageLoaders[`../../../../../node_modules/prismjs/components/prism-${lang}.js`];
    await loader?.();
}

// Look for the origin language by alias
export function transformAliasToOrigin(langs: string[]) {
    const result = [];

    for (const lang of langs) {
        if (languages[lang]) {
            result.push(lang);
        }
        else {
            const language = Object.keys(languages).find((name) => {
                const l = languages[name];
                if (l.alias) {
                    return (
                        l.alias === lang
                        || (Array.isArray(l.alias) && l.alias.includes(lang))
                    );
                }

                return false;
            });

            if (language) {
                result.push(language);
            }
            else {
                // The lang is not exist, the will handle in `initLoadLanguage`
                result.push(lang);
            }
        }
    }

    return result;
}

// Minimal Prism surface this module needs — full Prism typings live in
// prismjs's external @types package, but we only read `languages` here.
interface IPrismLike {
    languages: Record<string, unknown>;
}

function initLoadLanguage(Prism: IPrismLike) {
    return async function loadLanguages(langs?: string[] | string) {
    // If no argument is passed, load all components
        if (!langs)
            langs = Object.keys(languages).filter(lang => lang !== 'meta');

        if (langs && !langs.length) {
            return Promise.reject(
                new Error(
                    'The first parameter should be a list of load languages or single language.',
                ),
            );
        }

        if (!Array.isArray(langs))
            langs = [langs];

        const promises: Promise<ILangLoadStatus>[] = [];
        // The user might have loaded languages via some other way or used `prism.js` which already includes some
        // We don't need to validate the ids because `getLoader` will ignore invalid ones
        const loaded = [...loadedLanguages, ...Object.keys(Prism.languages)];
        getLoader(components, langs, loaded).load(async (lang: string) => {
            const defer = getDefer<ILangLoadStatus>();
            promises.push(defer.promise);
            if (!(lang in components.languages)) {
                defer.resolve({
                    lang,
                    status: 'noexist',
                });
            }
            else if (loadedLanguages.has(lang)) {
                defer.resolve({
                    lang,
                    status: 'cached',
                });
            }
            else {
                delete Prism.languages[lang];
                await loadPrismLanguage(lang);
                defer.resolve({
                    lang,
                    status: 'loaded',
                });
                loadedLanguages.add(lang);
            }
        });

        return Promise.all(promises);
    };
}

export default initLoadLanguage;
