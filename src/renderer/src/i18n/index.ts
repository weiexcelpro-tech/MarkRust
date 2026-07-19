import { createI18n } from 'vue-i18n'
import { compile, type MessageCompiler } from '@intlify/core-base'
import bus from '../bus'
// Directly import translation files
import enTranslations from '../../../../static/locales/en.json'
import { invoke } from '@tauri-apps/api/core'

// vue-i18n compiles each translation lazily on first use, and its compiler
// throws a SyntaxError on any value it can't parse — e.g. a literal `{{x}}`
// (nested placeholder) or stray linked-message syntax. A single malformed
// translation then crashed the renderer; during HTML/PDF export this surfaced
// as an "Unexpected renderer process error" even though the export itself
// succeeded (issue #4046). Reuse vue-i18n's own compiler so well-formed
// messages keep their `{name}` interpolation, plurals and linked references,
// and fall back to the raw text when compilation fails.
const safeMessageCompiler: MessageCompiler = (message, context) => {
  try {
    return compile(message, context)
  } catch (err) {
    if (typeof message === 'string') {
      return () => message
    }
    throw err
  }
}

// vue-i18n's options type intersection between Composition + Legacy modes is
// notoriously difficult to satisfy with mixed shapes; we cast the options once
// at the call site rather than spreading `any` further.
const i18n = createI18n({
  legacy: false,
  locale: 'en', // default is en
  fallbackLocale: 'en',
  messages: { en: enTranslations }, // Load en by default only
  // Disable linking to avoid '@' symbols being misinterpreted
  modifiers: {
    '@': () => '@'
  },
  // Disable plural parsing
  pluralRules: {},
  // Degrade malformed translations to raw text instead of crashing the renderer.
  messageCompiler: safeMessageCompiler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

// Export the translation function - Fix: correctly handle the Vue i18n v9+ global getter
export const t = (key: string, ...args: unknown[]): string => {
  // Check if the i18n instance is available
  if (!i18n) {
    console.warn('⚠️ i18n实例不可用，使用英文fallback')
    return key
  }

  try {
    // Correctly access the global property
    if (!i18n.global) {
      console.warn('⚠️ i18n.global not ready yet, falling back to EN')
      return key
    }

    // vue-i18n's `t` is heavily overloaded; the variadic call signature here
    // intentionally bypasses the strict overload set.
    return (i18n.global.t as (key: string, ...args: unknown[]) => string)(key, ...args)
  } catch (error) {
    console.error('❌ 翻译函数执行错误:', error)
    return key
  }
}

// Cache in-flight translation loads so that concurrent setLanguage() calls
// don't fire duplicate IPCs for the same locale.
const inflightLoads = new Map<string, Promise<Record<string, unknown> | undefined>>()

export const setLanguage = async(locale: string): Promise<void> => {
  if (!locale) return
  const globalI18n = i18n.global
  if (!globalI18n.availableLocales.includes(locale)) {
    let pending = inflightLoads.get(locale)
    if (!pending) {
      pending = Promise.resolve(window.i18nUtils.loadTranslations(locale)).finally(() =>
        inflightLoads.delete(locale)
      )
      inflightLoads.set(locale, pending)
    }
    const translation = await pending
    if (!translation) return // Failed to load locale file

    if (!globalI18n.availableLocales.includes(locale)) {
      globalI18n.setLocaleMessage(locale, translation)
      console.log(`🌐 Loaded and set new locale: ${locale}`)
    }
  }
  globalI18n.locale.value = locale

  // Rebuild native OS menu with translated labels
  try {
    await invoke('menu_rebuild_locale', { locale })
    // After menu rebuild, checkbox states are reset — re-sync from preferences
    await restoreMenuCheckboxStates()
  } catch (e) {
    console.warn('⚠️ Failed to rebuild menu for locale:', locale, e)
  }
}

// Export the current language getter function
export const getCurrentLanguage = (): string => {
  return i18n.global.locale.value
}

// Export the i18n instance (named and default export)
export { i18n }
export default i18n

/// After menu rebuild (locale switch), all checkbox states are reset.
/// Re-sync them from the preferences backend without going through the store
/// (avoiding circular i18n ↔ store dependency).
async function restoreMenuCheckboxStates(): Promise<void> {
  try {
    const prefs = await invoke<Record<string, unknown>>('preferences_get_all')
    const checks: Array<[string, boolean]> = [
      ['sourceCodeModeMenuItem', !!(prefs as any).sourceCode],
      ['typewriterModeMenuItem', !!(prefs as any).typewriter],
      ['focusModeMenuItem', !!(prefs as any).focus],
      ['sideBarMenuItem', !!(prefs as any).sideBarVisibility],
      ['tabBarMenuItem', !!(prefs as any).tabBarVisibility],
    ]
    // Also re-enable/disable typewriter & focus based on sourceCode mode
    const isSourceCode = !!(prefs as any).sourceCode
    for (const [id, checked] of checks) {
      invoke('menu_set_checked', { id, checked }).catch(() => {})
    }
    invoke('menu_set_enabled', { id: 'typewriterModeMenuItem', enabled: !isSourceCode }).catch(() => {})
    invoke('menu_set_enabled', { id: 'focusModeMenuItem', enabled: !isSourceCode }).catch(() => {})
  } catch (e) {
    console.warn('⚠️ Failed to restore menu checkbox states:', e)
  }
}

// Listen for language changes
if (window.electron && window.electron.ipcRenderer) {
  window.electron.ipcRenderer.on('language-changed', (_event, newLocale) => {
    setLanguage(newLocale)
    bus.emit('language-changed', newLocale)
  })

  // Request the current language setting at startup
  window.electron.ipcRenderer.send('mt::get-current-language')
  window.electron.ipcRenderer.on('mt::current-language', (_event, language) => {
    setLanguage(language)
    bus.emit('language-changed', language)
  })
}
