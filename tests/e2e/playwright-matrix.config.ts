import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 菜单矩阵专用配置：与基础配置一致，但 webServer 冷启动超时放宽到 3 分钟
// （release cargo 编译并行时会抢 CPU，vite 冷启动可能超过默认 30s）。
export default defineConfig({
  ...base,
  webServer: {
    ...base.webServer,
    timeout: 180000,
  },
})
