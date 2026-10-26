declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
declare module '*.css';
declare module '*.css?inline';
declare module '*.woff';
declare module '*.woff2';
declare module '*.woff2?inline' {
    const dataUri: string;
    export default dataUri;
}
declare module 'joplin-turndown-plugin-gfm';
declare module 'prismjs/plugins/keep-markup/prism-keep-markup';
declare module 'prismjs/dependencies';
declare module 'prismjs/components.js';
declare module '@marktext/file-icons';
declare module 'snapsvg-cjs';

declare module 'flowchart.js' {
    interface IFlowChartDrawOptions {
        [key: string]: unknown;
    }
    interface IFlowChartInstance {
        drawSVG: (container: HTMLElement | string, options?: IFlowChartDrawOptions) => void;
        clean: () => void;
    }
    export function parse(input: string): IFlowChartInstance;
    const flowchart: { parse: typeof parse };
    export default flowchart;
}

declare module '*sequence-diagram-snap' {
    interface ISequenceDrawOptions {
        theme?: 'hand' | 'simple';
        [key: string]: unknown;
    }
    interface ISequenceDiagramInstance {
        drawSVG: (container: HTMLElement | string, options?: ISequenceDrawOptions) => void;
    }
    interface ISequenceDiagramConstructor {
        parse: (input: string) => ISequenceDiagramInstance;
    }
    const Diagram: ISequenceDiagramConstructor;
    export default Diagram;
}

// Vite `import.meta.glob` 的最小可用面（本包未引入 vite/client 类型，
// 在此本地声明；返回惰性动态导入加载器表）。供 utils/prism/loadLanguage
// 静态登记 prismjs 语言组件使用。
interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
}
