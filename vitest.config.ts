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
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      'common': fileURLToPath(new URL('./src/common', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@muyajs/core': fileURLToPath(new URL('./packages/muya/src/index.ts', import.meta.url)),
      'path': 'pathe',
      'global': 'globalThis',
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
  },
})
