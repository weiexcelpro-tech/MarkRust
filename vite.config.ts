import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// 从 tauri.conf.json 读取产品版本号，注入前端供 About 对话框显示
const tauriConf = JSON.parse(readFileSync(fileURLToPath(new URL("./src-tauri/tauri.conf.json", import.meta.url)), "utf-8"));
const appVersion = `v${tauriConf.version}`;

// @tauri-apps/cli 在 dev 模式下设置 TAURI_ENV_PLATFORM，触发 strictPort + clearScreen
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    vue(),
    {
      name: 'svg-to-vue',
      enforce: 'pre',
      transform(_code, id) {
        if (!id.endsWith('.svg')) return null
        const svg = readFileSync(id, 'utf-8')
          .replace(/`/g, '\\`')
          .replace(/\$\{/g, '\\${')
        return { code: `import { h } from 'vue'\nexport default { render() { return h('span', { innerHTML: \`${svg}\`, style: 'display:inline-flex' }) } }`, map: null }
      }
    }
  ],

  // CJS 依赖（dragula→crossvent→custom-event）引用 Node `global`，
  // resolve.alias 只对 ES import 生效；define 在编译时替换所有引用。
  define: {
    global: 'globalThis',
    'process.env.MARKTEXT_VERSION_STRING': JSON.stringify(appVersion),
  },

  // 预声明全部依赖，避免运行时发现新依赖触发重新优化（504 Outdated Optimize Dep）
  optimizeDeps: {
    include: [
      'vue', 'vue-router', 'pinia', 'axios', 'vue-i18n',
      '@intlify/core-base',       '@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/window',
      '@tauri-apps/plugin-dialog',
      'element-plus', 'element-plus/es/locale/lang/en', '@element-plus/icons-vue',
      'pathe', 'mitt', 'dayjs', 'dompurify', 'iso-639-1', 'deep-equal',
      'lodash/debounce', 'dom-autoscroller', 'dragula', 'fuzzaldrin',
      'codemirror/lib/codemirror', 'codemirror/mode/markdown/markdown',
      'codemirror/mode/gfm/gfm', 'codemirror/mode/stex/stex',
      'codemirror/addon/edit/closebrackets', 'codemirror/addon/edit/closetag',
      'codemirror/addon/selection/active-line', 'codemirror/mode/meta',
      'fuse.js', '@floating-ui/dom', 'snabbdom', 'snabbdom-to-html',
      'ot-text-unicode', 'rxjs', 'html-tags', 'mermaid', 'vega-embed',
      'flowchart.js', 'prismjs', 'prismjs/components.js',
      'prismjs/plugins/keep-markup/prism-keep-markup', 'prismjs/dependencies',
      'marked', 'ot-json1', 'marked-highlight', 'fast-diff', 'execall',
      'katex', 'katex/dist/contrib/mhchem.mjs',
      'joplin-turndown-plugin-gfm', 'turndown',
    ],
  },

  // Tauri 期望前端在 1420 端口（与 src-tauri/tauri.conf.json 的 devUrl 对应）
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 忽略 Rust 端文件，避免触发 vite HMR
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: {
      ...(process.env.E2E_TEST ? {
        '@tauri-apps/api/event': fileURLToPath(new URL('./tests/e2e/mock-api-event.ts', import.meta.url)),
      } : {}),
      // renderer 内的 @ 别名指向 renderer/src/（与 marktext-develop electron.vite.config.ts 对齐）
      "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
      // common helpers（@marktext/desktop common）
      "common": fileURLToPath(new URL("./src/common", import.meta.url)),
      // shared types
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      // muya 编辑器引擎（源码入口，含 Phase 2 性能修复：labels cache + lazy inline render）
      "@muyajs/core": fileURLToPath(
        new URL("./packages/muya/src/index.ts", import.meta.url),
      ),
      // renderer/muya 代码用 `import path from 'path'`，替换为 pathe（纯 JS 路径，无 IPC）
      "path": "pathe",
      "global": "globalThis",
      // electron 包 shims：渲染层所有 `import 'electron*'` 指向本地空/兼容实现
      "electron-log/renderer": fileURLToPath(new URL("./src/renderer/src/shims/electron-log.ts", import.meta.url)),
      "electron-log": fileURLToPath(new URL("./src/renderer/src/shims/electron-log.ts", import.meta.url)),
      "electron-updater": fileURLToPath(new URL("./src/renderer/src/shims/electron-updater.ts", import.meta.url)),
      "electron": fileURLToPath(new URL("./src/renderer/src/shims/electron.ts", import.meta.url)),
      "@hfelix/electron-localshortcut": fileURLToPath(new URL("./src/renderer/src/shims/electron-localshortcut.ts", import.meta.url)),
    },
  },

  // 生产构建产物路径：dist/（与 tauri.conf.json 的 frontendDist 对应）
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: !!process.env.DEBUG,
    chunkSizeWarningLimit: 2048,
  },
}));
