import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 菜单矩阵专用配置：与基础配置一致，但冷启动相关超时放宽——
// ① webServer 启动 3 分钟（cargo 编译并行时 vite 起得慢）；
// ② 页面导航 2 分钟：vite dev 对首个页面请求才按需编译应用入口，
//    冷服务器的第一批用例（矩阵按字母序是 paragraph.heading-*）会在
//    默认 30s 的 page.goto 上超时——用例本身并没有失败。
export default defineConfig({
  ...base,
  timeout: 120000,
  use: {
    ...base.use,
    navigationTimeout: 120000,
  },
  webServer: {
    ...base.webServer,
    timeout: 180000,
  },
})
