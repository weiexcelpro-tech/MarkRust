// 全局测试环境兜底（每个测试文件执行前运行）。
//
// happy-dom 执行上下文里 process.env 可能缺失；@intlify/shared（vue-i18n 依赖）
// 顶层读取 `process.env.NODE_ENV`，缺失时直接 TypeError，导致任何 import 到
// i18n 链路的模块都无法加载。这里在所有模块执行前补齐。
const g = globalThis as unknown as Record<string, any>
if (!g.process) {
  g.process = { env: {} }
}
if (!g.process.env) {
  g.process.env = {}
}
if (!g.process.env.NODE_ENV) {
  g.process.env.NODE_ENV = 'test'
}

export {}
