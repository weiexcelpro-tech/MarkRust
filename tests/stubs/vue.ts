/**
 * vue 测试入口包装：先补齐 process.env（ensure-process-env 先于 vue 求值），
 * 再 re-export 真正的 ESM bundler 构建。详见 ensure-process-env.ts 的说明。
 */
import './ensure-process-env'

export * from '../../node_modules/vue/dist/vue.esm-bundler.js'
export { default } from '../../node_modules/vue/dist/vue.esm-bundler.js'
