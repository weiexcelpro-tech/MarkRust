import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Vitest 配置：与 vite.config.ts 别名对齐；happy-dom 提供 window 全局；
// `define.global` 让依赖 Node `global` 的 CJS 库（dragula 链）在测试中工作。
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    setupFiles: ['./tests/setup.global.ts'],
    // vue-i18n/@intlify 以原生 ESM 外部化导入时 `import.meta.env` 未定义，
    // @intlify/shared 直接读 `import.meta.env.NODE_ENV` 会抛 TypeError；
    // inline 让 vitest 转换这些依赖并注入 import.meta.env。
    server: {
      deps: {
        inline: [/^vue$/, /^vue\//, /vue-demi/, /pinia/, /vue-i18n/, /@intlify/],
        // vue 的 CJS 回退入口（index.js）在模块 realm 里读不到 process.env；
        // 禁用 CJS 回退强制走 ESM exports（esm-bundler，vite 转换 + define 生效）。
        fallbackCJS: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      'common': fileURLToPath(new URL('./src/common', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@muyajs/core': fileURLToPath(new URL('./packages/muya/src/index.ts', import.meta.url)),
      'path': 'pathe',
      'global': 'globalThis',
      // vitest 4 module-runner 下依赖求值 realm 的 process.env 可能缺失，
      // vue.esm-bundler.js 顶层读取 process.env.NODE_ENV 会直接 TypeError。
      // 经由包装入口（tests/stubs/vue.ts）在 vue 求值前补齐当前 realm 的
      // process.env，再 re-export 真正的 ESM bundler 构建。
      'vue': fileURLToPath(new URL('./tests/stubs/vue.ts', import.meta.url)),
      // electron-log is a production-only dep; stub it so bootstrap.ts can be
      // imported in tests without install.
      'electron-log/renderer': fileURLToPath(new URL('./tests/stubs/electron-log-renderer.ts', import.meta.url)),
      'electron-log': fileURLToPath(new URL('./tests/stubs/electron-log-renderer.ts', import.meta.url)),
      'electron': fileURLToPath(new URL('./src/renderer/src/shims/electron.ts', import.meta.url)),
      'electron-updater': fileURLToPath(new URL('./src/renderer/src/shims/electron-updater.ts', import.meta.url)),
      '@hfelix/electron-localshortcut': fileURLToPath(new URL('./src/renderer/src/shims/electron-localshortcut.ts', import.meta.url)),
    },
  },
  define: {
    global: 'globalThis',
    // vue-i18n/@intlify 内联后读到裸的 process.env.NODE_ENV（happy-dom 环境不可靠），
    // 显式 define 成字面量，与 vitest 默认 NODE_ENV=test 语义一致。
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
})
