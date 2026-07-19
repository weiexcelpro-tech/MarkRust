import './tauri-bridge'
import './menuBridge'
import { setupKeyboardShortcuts } from './keyboardShortcut'
import { createApp, type App } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { createRouter, createWebHashHistory } from 'vue-router'
import bootstrapRenderer from './bootstrap'
import axios from './axios'
import pinia from './store'
import './assets/symbolIcon'

// Element Plus instead of Element UI for Vue 3
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import en from 'element-plus/es/locale/lang/en'

// I18n translation system
import i18nPlugin from './i18n'

// something is wrong here! \/
import services from './services/index'
import routes from './router'
import Main from './Main.vue'

import './assets/styles/index.css'
import './assets/styles/printService.css'
import './assets/styles/muya/variables.css'
import './assets/styles/muya/blockSyntax.css'
import './assets/styles/muya/inlineSyntax.css'

// -----------------------------------------------

window.marktext = {}
// 等待 tauri-bridge 异步获取 app_data_dir 完成后再执行 bootstrap
// （bootstrap 的 parseUrlArgs 从 URL 读取 udp 参数，若异步还没写好就会拿到空值）
const userDataDirReady = (globalThis as Record<string, unknown>).__TAURI_USER_DATA_DIR_READY__ as Promise<void> | undefined
;(async () => {
  if (userDataDirReady) {
    await userDataDirReady
  }
  bootstrapRenderer()
  setupKeyboardShortcuts()
})()

// -----------------------------------------------
// Be careful when changing code before this line!

// Create Vue app
const app: App<Element> = createApp(Main)

// Configure Element Plus with locale
app.use(ElementPlus, {
  locale: en
})

const envType = new URLSearchParams(window.location.search).get('type') || 'editor'

const router = createRouter({
  history: createWebHashHistory(),
  // it seems like something might have changed in vue-router? it uses the full "file path" instead of
  // links like /editor if we use the old createWebHistory()
  routes: routes(envType)
})

app.use(router)
app.use(pinia)
app.use(i18nPlugin)

// Configure axios globally
app.config.globalProperties.$http = axios

// Register services globally
;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
  app.config.globalProperties['$' + s.name] = s[s.name]
})

// Mount the app
app.mount('#app')

// Signal to tauri-bridge that the Vue app is mounted and the renderer is ready
// to receive the bootstrap-editor event. This replaces the fixed 800ms delay
// with an event-driven approach for faster startup.
window.dispatchEvent(new Event('mt::renderer-ready'))

invoke<string | null>('get_launch_file').then(launchFile => {
  if (launchFile) {
    setTimeout(() => {
      window.electron.ipcRenderer.send('mt::open-file', launchFile, {})
    }, 500)
  }
})
