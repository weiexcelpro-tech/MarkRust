import {
  THEME_STYLE_ID,
  COMMON_STYLE_ID,
  DEFAULT_CODE_FONT_FAMILY,
  oneDarkThemes,
  railscastsThemes
} from '../config'
import {
  dark,
  graphite,
  materialDark,
  oneDark,
  ulysses,
  // New gogh themes - Dark
  dracula,
  nord,
  catppuccinMocha,
  gruvboxDark,
  tokyoNight,
  tokyoNightStorm,
  solarizedDark,
  ayuDark,
  ayuMirage,
  everforestDark,
  rosePine,
  rosePineMoon,
  monokaiPro,
  synthwave84,
  horizonDark,
  palenight,
  oxocarbonDark,
  kanagawa,
  nightfox,
  cyberdream,
  // New gogh themes - Light
  catppuccinLatte,
  gruvboxLight,
  tokyoNightLight,
  solarizedLight,
  ayuLight,
  everforestLight,
  rosePineDawn
} from './themeColor'
import { isLinux } from './index'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ORIGINAL_THEME = '#409EFF'

const patchTheme = (css: string): string => {
  return `@media not print {\n${css}\n}`
}

const getEmojiPickerPatch = (): string => {
  return isLinux
    ? '.mu-emoji-picker section .emoji-wrapper .item span { font-family: sans-serif, "Noto Color Emoji"; }'
    : ''
}

export const addThemeStyle = (theme: string): void => {
  const isCmRailscasts = railscastsThemes.includes(theme)
  const isCmOneDark = oneDarkThemes.includes(theme)
  const isDarkTheme = isCmOneDark || isCmRailscasts
  let themeStyleEle = document.querySelector(`#${THEME_STYLE_ID}`) as HTMLStyleElement | null
  if (!themeStyleEle) {
    themeStyleEle = document.createElement('style')
    themeStyleEle.id = THEME_STYLE_ID
    document.head.appendChild(themeStyleEle)
  }

  switch (theme) {
    case 'light':
      themeStyleEle.innerHTML = patchTheme(
        ':root {\n  --link-color: var(--linkColor);\n  --blockquote-border-color: var(--blockquoteBorderColor);\n}'
      )
      break
    case 'dark':
      themeStyleEle.innerHTML = patchTheme(dark())
      break
    case 'material-dark':
      themeStyleEle.innerHTML = patchTheme(materialDark())
      break
    case 'ulysses':
      themeStyleEle.innerHTML = patchTheme(ulysses())
      break
    case 'graphite':
      themeStyleEle.innerHTML = patchTheme(graphite())
      break
    case 'one-dark':
      themeStyleEle.innerHTML = patchTheme(oneDark())
      break
    // New gogh themes - Dark
    case 'dracula':
      themeStyleEle.innerHTML = patchTheme(dracula())
      break
    case 'nord':
      themeStyleEle.innerHTML = patchTheme(nord())
      break
    case 'catppuccin-mocha':
      themeStyleEle.innerHTML = patchTheme(catppuccinMocha())
      break
    case 'gruvbox-dark':
      themeStyleEle.innerHTML = patchTheme(gruvboxDark())
      break
    case 'tokyo-night':
      themeStyleEle.innerHTML = patchTheme(tokyoNight())
      break
    case 'tokyo-night-storm':
      themeStyleEle.innerHTML = patchTheme(tokyoNightStorm())
      break
    case 'solarized-dark':
      themeStyleEle.innerHTML = patchTheme(solarizedDark())
      break
    case 'ayu-dark':
      themeStyleEle.innerHTML = patchTheme(ayuDark())
      break
    case 'ayu-mirage':
      themeStyleEle.innerHTML = patchTheme(ayuMirage())
      break
    case 'everforest-dark':
      themeStyleEle.innerHTML = patchTheme(everforestDark())
      break
    case 'rose-pine':
      themeStyleEle.innerHTML = patchTheme(rosePine())
      break
    case 'rose-pine-moon':
      themeStyleEle.innerHTML = patchTheme(rosePineMoon())
      break
    case 'monokai-pro':
      themeStyleEle.innerHTML = patchTheme(monokaiPro())
      break
    case 'synthwave-84':
      themeStyleEle.innerHTML = patchTheme(synthwave84())
      break
    case 'horizon-dark':
      themeStyleEle.innerHTML = patchTheme(horizonDark())
      break
    case 'palenight':
      themeStyleEle.innerHTML = patchTheme(palenight())
      break
    case 'oxocarbon-dark':
      themeStyleEle.innerHTML = patchTheme(oxocarbonDark())
      break
    case 'kanagawa':
      themeStyleEle.innerHTML = patchTheme(kanagawa())
      break
    case 'nightfox':
      themeStyleEle.innerHTML = patchTheme(nightfox())
      break
    case 'cyberdream':
      themeStyleEle.innerHTML = patchTheme(cyberdream())
      break
    // New gogh themes - Light
    case 'catppuccin-latte':
      themeStyleEle.innerHTML = patchTheme(catppuccinLatte())
      break
    case 'gruvbox-light':
      themeStyleEle.innerHTML = patchTheme(gruvboxLight())
      break
    case 'tokyo-night-light':
      themeStyleEle.innerHTML = patchTheme(tokyoNightLight())
      break
    case 'solarized-light':
      themeStyleEle.innerHTML = patchTheme(solarizedLight())
      break
    case 'ayu-light':
      themeStyleEle.innerHTML = patchTheme(ayuLight())
      break
    case 'everforest-light':
      themeStyleEle.innerHTML = patchTheme(everforestLight())
      break
    case 'rose-pine-dawn':
      themeStyleEle.innerHTML = patchTheme(rosePineDawn())
      break
    default:
      break
  }

  // workaround: use dark icons
  document.body.classList.remove('dark')
  if (isDarkTheme) {
    document.body.classList.add('dark')
  }

  // Sync Element Plus CSS variables with the current theme so that EP components
  // (radio labels, select text, input placeholders, etc.) are readable in dark themes.
  // Without this, EP uses its own hardcoded --el-text-color-primary (#303133) which
  // is near-black and invisible on dark backgrounds.
  const elThemeStyleId = 'el-theme-override'
  let elStyleEle = document.querySelector(`#${elThemeStyleId}`) as HTMLStyleElement | null
  if (!elStyleEle) {
    elStyleEle = document.createElement('style')
    elStyleEle.id = elThemeStyleId
    document.head.appendChild(elStyleEle)
  }
  if (isDarkTheme) {
    elStyleEle.innerHTML = `:root,
:root:root,
.pref-container {
  --el-text-color-primary: var(--editorColor) !important;
  --el-text-color-regular: var(--editorColor80) !important;
  --el-text-color-secondary: var(--editorColor60) !important;
  --el-text-color-placeholder: var(--editorColor40) !important;
  --el-text-color-disabled: var(--editorColor30) !important;
  --el-fill-color-blank: transparent !important;
  --el-fill-color-light: var(--editorColor04) !important;
  --el-bg-color: transparent !important;
  --el-bg-color-overlay: var(--editorBgColor) !important;
  --el-border-color: var(--editorColor10) !important;
  --el-border-color-light: var(--editorColor10) !important;
  --el-border-color-lighter: var(--editorColor04) !important;
}
/* Direct text color overrides for prefComponents that inherit EP's
   hardcoded #303133 via CSS reset or specificity */
.pref-container .description,
.pref-container .description span,
.pref-container .el-radio__label,
.pref-container .el-select__placeholder,
.pref-container .el-select__selected-item,
.pref-container .el-input__inner,
.pref-container .el-input__wrapper,
.pref-container .el-checkbox__label,
.pref-container .el-form-item__label,
.pref-container .el-radio-group .el-radio,
.pref-container .pref-switch-item,
.pref-container .pref-switch-item span,
.pref-container .pref-compound-item,
.pref-container .pref-compound-item span,
.pref-container .pref-select-item,
.pref-container .pref-range-item {
  color: var(--editorColor) !important;
  -webkit-text-fill-color: var(--editorColor) !important;
}
/* Select dropdowns also need text color fix */
.pref-container .el-select-dropdown__item {
  color: var(--editorColor) !important;
}
/* Input placeholders in dark theme */
.pref-container .el-input__inner::placeholder {
  color: var(--editorColor40) !important;
}`
  } else {
    // Reset to EP defaults for light themes
    elStyleEle.innerHTML = ''
  }

  // change CodeMirror theme
  const cm = document.querySelector('.CodeMirror')
  if (cm) {
    cm.classList.remove('cm-s-default')
    cm.classList.remove('cm-s-one-dark')
    cm.classList.remove('cm-s-railscasts')
    if (isCmOneDark) {
      cm.classList.add('cm-s-one-dark')
    } else if (isCmRailscasts) {
      cm.classList.add('cm-s-railscasts')
    } else {
      cm.classList.add('cm-s-default')
    }
  }
}

export const setEditorWidth = (value: string): void => {
  const EDITOR_WIDTH_STYLE_ID = 'editor-width'
  let result = ''
  if (value && /^[0-9]+(?:ch|px|%)$/.test(value)) {
    // Overwrite the theme value and add 100px for padding.
    result = `:root { --editorAreaWidth: calc(100px + ${value}); }`
  }
  let styleEle = document.querySelector(`#${EDITOR_WIDTH_STYLE_ID}`) as HTMLStyleElement | null
  if (!styleEle) {
    styleEle = document.createElement('style')
    styleEle.setAttribute('id', EDITOR_WIDTH_STYLE_ID)
    document.head.appendChild(styleEle)
  }

  styleEle.innerHTML = result
}

export interface CommonStyleOptions {
  codeFontFamily: string
  codeFontSize: number | string
  hideScrollbar?: boolean
  [key: string]: unknown
}

export const addCommonStyle = (options: CommonStyleOptions): void => {
  const { codeFontFamily, codeFontSize, hideScrollbar } = options
  let sheet = document.querySelector(`#${COMMON_STYLE_ID}`) as HTMLStyleElement | null
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = COMMON_STYLE_ID
    document.head.appendChild(sheet)
  }

  let scrollbarStyle = ''
  if (hideScrollbar) {
    scrollbarStyle = '::-webkit-scrollbar {display: none;}'
  }

  sheet.innerHTML = `${scrollbarStyle}
.CodeMirror {
font-family: ${codeFontFamily}, ${DEFAULT_CODE_FONT_FAMILY};
font-size: ${codeFontSize}px;
}

${getEmojiPickerPatch()}
`
}

export interface CustomStyleOptions {
  customCss?: string
  [key: string]: unknown
}

export const addCustomStyle = (options: CustomStyleOptions): void => {
  const { customCss } = options
  if (!customCss) return

  let customStyleEle = document.querySelector('#custom-styles') as HTMLStyleElement | null
  if (!customStyleEle) {
    customStyleEle = document.createElement('style')
    customStyleEle.id = 'custom-styles'
    document.head.appendChild(customStyleEle)
  }
  customStyleEle.innerHTML = customCss
}

export interface AddStylesOptions extends CommonStyleOptions {
  theme: string
}

// Append common sheet and theme at the end of head - order is important.
export const addStyles = (options: AddStylesOptions): void => {
  const { theme } = options
  addThemeStyle(theme)
  addCommonStyle(options)
}
