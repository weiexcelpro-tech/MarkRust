/**
 * 补齐当前模块求值 realm 的 process.env（必须在 vue 之前求值）。
 *
 * vitest 4（Vite 6 module-runner）下，依赖模块的求值 realm 里
 * `process.env` 可能缺失，而 vue.esm-bundler.js 顶层读取
 * `process.env.NODE_ENV`（SSR 转换时 define 明确不替换 process.env.*，
 * 以保留 Node 语义）。
 */
const g = globalThis as unknown as Record<string, any>
if (!g.process) {
  g.process = {}
}
if (!g.process.env) {
  g.process.env = {}
}
if (!g.process.env.NODE_ENV) {
  g.process.env.NODE_ENV = 'test'
}

export {}
