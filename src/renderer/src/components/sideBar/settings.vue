<template>
  <div class="sidebar-settings">
    <div class="settings-header">
      <h3>{{ $t('sideBar.icons.settings') }}</h3>
    </div>
    <div class="settings-body">
      <!-- ==================== GENERAL ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('general')">
          {{ $t('preferences.general.title') }}
          <span class="chevron" :class="{ open: expanded.general }">&#9654;</span>
        </div>
        <div v-show="expanded.general" class="group-content">
          <!-- Auto Save -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.general.autoSave.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.autoSave.description') }}</label>
              <input type="checkbox" :checked="prefs.autoSave" @change="set('autoSave', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.autoSave.delayDescription') }}</label>
              <input type="range" :value="prefs.autoSaveDelay" min="1000" max="10000" step="100"
                @input="set('autoSaveDelay', Number(($event.target as HTMLInputElement).value))" class="range-input" />
              <span class="range-value">{{ prefs.autoSaveDelay }}</span>
            </div>
          </div>
          <!-- Window -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.general.window.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.window.titleBarStyle.title') }}</label>
              <select :value="prefs.titleBarStyle" @change="set('titleBarStyle', ($event.target as HTMLSelectElement).value)">
                <option value="custom">{{ $t('preferences.general.window.titleBarStyle.custom') }}</option>
                <option value="native">{{ $t('preferences.general.window.titleBarStyle.native') }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.window.zoom') }}</label>
              <select :value="prefs.zoom" @change="set('zoom', Number(($event.target as HTMLSelectElement).value))">
                <option v-for="z in zoomLevels" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.window.hideScrollbars') }}</label>
              <input type="checkbox" :checked="prefs.hideScrollbar" @change="set('hideScrollbar', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.window.openFilesInNewWindow') }}</label>
              <input type="checkbox" :checked="prefs.openFilesInNewWindow" @change="set('openFilesInNewWindow', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.window.openFoldersInNewWindow') }}</label>
              <input type="checkbox" :checked="prefs.openFolderInNewWindow" @change="set('openFolderInNewWindow', $e($event))" />
            </div>
          </div>
          <!-- Sidebar -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.general.sidebar.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.sidebar.wrapTextInToc') }}</label>
              <input type="checkbox" :checked="prefs.wordWrapInToc" @change="set('wordWrapInToc', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.sidebar.showOpenedFiles') }}</label>
              <input type="checkbox" :checked="prefs.openedFilesInSidebar" @change="set('openedFilesInSidebar', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.sidebar.fileSortBy.title') }}</label>
              <select :value="prefs.fileSortBy" @change="set('fileSortBy', ($event.target as HTMLSelectElement).value)">
                <option value="created">{{ $t('preferences.general.sidebar.fileSortBy.creationTime') }}</option>
                <option value="modified">{{ $t('preferences.general.sidebar.fileSortBy.modificationTime') }}</option>
                <option value="title">{{ $t('preferences.general.sidebar.fileSortBy.filename') }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.sidebar.fileSortOrder.title') }}</label>
              <select :value="prefs.fileSortOrder" @change="set('fileSortOrder', ($event.target as HTMLSelectElement).value)">
                <option value="asc">{{ $t('preferences.general.sidebar.fileSortOrder.aToZ') }}</option>
                <option value="desc">{{ $t('preferences.general.sidebar.fileSortOrder.zToA') }}</option>
              </select>
            </div>
          </div>
          <!-- Startup -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.general.startup.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.startup.restorePreviousState') }}</label>
              <input type="checkbox" :checked="prefs.restoreLayoutState" @change="set('restoreLayoutState', $e($event))" />
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.general.startup.startupFilesFolders') }}</label>
              <select :value="prefs.startUpAction" @change="set('startUpAction', ($event.target as HTMLSelectElement).value)">
                <option value="restoreAll">{{ $t('preferences.general.startup.restoreAll') }}</option>
                <option value="openLastFolder">{{ $t('preferences.general.startup.openLastFolder') }}</option>
                <option value="folder">{{ $t('preferences.general.startup.openDefaultDirectory') }}</option>
                <option value="blank">{{ $t('preferences.general.startup.openBlankPage') }}</option>
              </select>
            </div>
          </div>
          <!-- Language -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.general.misc.language.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.general.misc.language.title') }}</label>
              <select :value="prefs.language" @change="set('language', ($event.target as HTMLSelectElement).value)">
                <option value="en">{{ $t('preferences.general.misc.language.english') }}</option>
                <option value="zh-CN">{{ $t('preferences.general.misc.language.chinese') }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== EDITOR ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('editor')">
          {{ $t('preferences.editor.title') }}
          <span class="chevron" :class="{ open: expanded.editor }">&#9654;</span>
        </div>
        <div v-show="expanded.editor" class="group-content">
          <!-- Text Editor -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.editor.textEditor.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.textEditor.fontSize') }}</label>
              <input type="number" min="12" max="32" :value="prefs.fontSize"
                @change="set('fontSize', Number(($event.target as HTMLInputElement).value))" class="number-input" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.textEditor.lineHeight') }}</label>
              <input type="range" :value="prefs.lineHeight" min="1.2" max="2.0" step="0.1"
                @input="set('lineHeight', Number(($event.target as HTMLInputElement).value))" class="range-input" />
              <span class="range-value">{{ prefs.lineHeight }}</span>
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.editor.textEditor.fontFamily') }}</label>
              <select :value="prefs.editorFontFamily" @change="set('editorFontFamily', ($event.target as HTMLSelectElement).value)">
                <option v-for="f in systemFonts" :key="f" :value="f">{{ f }}</option>
              </select>
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.editor.textEditor.maxWidth') }}</label>
              <input type="text" :value="prefs.editorLineWidth" placeholder="e.g. 750px"
                @change="set('editorLineWidth', ($event.target as HTMLInputElement).value)" class="text-input" />
            </div>
          </div>
          <!-- Code Block -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.editor.codeBlock.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.codeBlock.fontSize') }}</label>
              <input type="number" min="12" max="28" :value="prefs.codeFontSize"
                @change="set('codeFontSize', Number(($event.target as HTMLInputElement).value))" class="number-input" />
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.editor.codeBlock.fontFamily') }}</label>
              <select :value="prefs.codeFontFamily" @change="set('codeFontFamily', ($event.target as HTMLSelectElement).value)">
                <option v-for="f in systemFonts" :key="f" :value="f">{{ f }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.codeBlock.showLineNumbers') }}</label>
              <input type="checkbox" :checked="prefs.codeBlockLineNumbers" @change="set('codeBlockLineNumbers', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.codeBlock.removeEmptyLines') }}</label>
              <input type="checkbox" :checked="prefs.trimUnnecessaryCodeBlockEmptyLines" @change="set('trimUnnecessaryCodeBlockEmptyLines', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.wrapCodeBlocks') }}</label>
              <input type="checkbox" :checked="prefs.wrapCodeBlocks" @change="set('wrapCodeBlocks', $e($event))" />
            </div>
          </div>
          <!-- Writing Behavior -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.editor.writingBehavior.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.writingBehavior.autoCloseBrackets') }}</label>
              <input type="checkbox" :checked="prefs.autoPairBracket" @change="set('autoPairBracket', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.writingBehavior.autoCompleteMarkdown') }}</label>
              <input type="checkbox" :checked="prefs.autoPairMarkdownSyntax" @change="set('autoPairMarkdownSyntax', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.writingBehavior.autoCloseQuotes') }}</label>
              <input type="checkbox" :checked="prefs.autoPairQuote" @change="set('autoPairQuote', $e($event))" />
            </div>
          </div>
          <!-- File Representation -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.editor.fileRepresentation.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.fileRepresentation.tabWidth') }}</label>
              <select :value="prefs.tabSize" @change="set('tabSize', Number(($event.target as HTMLSelectElement).value))">
                <option :value="1">1</option>
                <option :value="2">2</option>
                <option :value="3">3</option>
                <option :value="4">4</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.fileRepresentation.lineSeparator') }}</label>
              <select :value="prefs.endOfLine" @change="set('endOfLine', ($event.target as HTMLSelectElement).value)">
                <option value="default">{{ $t('preferences.editor.fileRepresentation.endOfLine.default') }}</option>
                <option value="lf">{{ $t('preferences.editor.fileRepresentation.endOfLine.lf') }}</option>
                <option value="crlf">{{ $t('preferences.editor.fileRepresentation.endOfLine.crlf') }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.fileRepresentation.defaultEncoding') }}</label>
              <select :value="prefs.defaultEncoding" @change="set('defaultEncoding', ($event.target as HTMLSelectElement).value)">
                <option value="utf8">UTF-8</option>
                <option value="utf8bom">UTF-8 BOM</option>
                <option value="utf16le">UTF-16 LE</option>
                <option value="utf16be">UTF-16 BE</option>
                <option value="ascii">ASCII</option>
                <option value="gbk">GBK</option>
                <option value="gb2312">GB2312</option>
                <option value="big5">Big5</option>
                <option value="shiftjis">Shift-JIS</option>
                <option value="euckr">EUC-KR</option>
                <option value="iso88591">ISO-8859-1</option>
                <option value="windows1252">Windows-1252</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.fileRepresentation.autoDetectEncoding') }}</label>
              <input type="checkbox" :checked="prefs.autoGuessEncoding" @change="set('autoGuessEncoding', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.autoNormalizeLineEndings') }}</label>
              <input type="checkbox" :checked="prefs.autoNormalizeLineEndings" @change="set('autoNormalizeLineEndings', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.fileRepresentation.trailingNewlines.title') }}</label>
              <select :value="prefs.trimTrailingNewline" @change="set('trimTrailingNewline', Number(($event.target as HTMLSelectElement).value))">
                <option :value="0">{{ $t('preferences.editor.fileRepresentation.trailingNewlines.trimAll') }}</option>
                <option :value="1">{{ $t('preferences.editor.fileRepresentation.trailingNewlines.ensureOne') }}</option>
                <option :value="2">{{ $t('preferences.editor.fileRepresentation.trailingNewlines.preserve') }}</option>
                <option :value="3">{{ $t('preferences.editor.fileRepresentation.trailingNewlines.doNothing') }}</option>
              </select>
            </div>
          </div>
          <!-- Editor Misc -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.editor.misc.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.textDirection.title') }}</label>
              <select :value="prefs.textDirection" @change="set('textDirection', ($event.target as HTMLSelectElement).value)">
                <option value="ltr">{{ $t('preferences.editor.misc.textDirection.ltr') }}</option>
                <option value="rtl">{{ $t('preferences.editor.misc.textDirection.rtl') }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.view.sourceCodeMode') }}</label>
              <input type="checkbox" :checked="prefs.sourceCode" @change="set('sourceCode', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.view.typewriterMode') }}</label>
              <input type="checkbox" :checked="prefs.typewriter" @change="set('typewriter', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.view.focusMode') }}</label>
              <input type="checkbox" :checked="prefs.focus" @change="set('focus', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.hideQuickInsertHint') }}</label>
              <input type="checkbox" :checked="prefs.hideQuickInsertHint" @change="set('hideQuickInsertHint', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.hideLinkPopup') }}</label>
              <input type="checkbox" :checked="prefs.hideLinkPopup" @change="set('hideLinkPopup', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.editor.misc.autoCheck') }}</label>
              <input type="checkbox" :checked="prefs.autoCheck" @change="set('autoCheck', $e($event))" />
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== MARKDOWN ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('markdown')">
          {{ $t('preferences.markdown.title') }}
          <span class="chevron" :class="{ open: expanded.markdown }">&#9654;</span>
        </div>
        <div v-show="expanded.markdown" class="group-content">
          <!-- Lists -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.markdown.lists.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.lists.preferLooseListItem') }}</label>
              <input type="checkbox" :checked="prefs.preferLooseListItem" @change="set('preferLooseListItem', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.lists.bulletListMarker') }}</label>
              <select :value="prefs.bulletListMarker" @change="set('bulletListMarker', ($event.target as HTMLSelectElement).value)">
                <option value="*">*</option>
                <option value="-">-</option>
                <option value="+">+</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.lists.orderListDelimiter') }}</label>
              <select :value="prefs.orderListDelimiter" @change="set('orderListDelimiter', ($event.target as HTMLSelectElement).value)">
                <option value=".">.</option>
                <option value=")">)</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.lists.listIndentation.title') }}</label>
              <select :value="prefs.listIndentation" @change="set('listIndentation', ($event.target as HTMLSelectElement).value)">
                <option value="dfm">{{ $t('preferences.markdown.lists.listIndentation.dfm') }}</option>
                <option value="tab">{{ $t('preferences.markdown.lists.listIndentation.tab') }}</option>
                <option :value="1">{{ $t('preferences.markdown.lists.listIndentation.oneSpace') }}</option>
                <option :value="2">{{ $t('preferences.markdown.lists.listIndentation.twoSpaces') }}</option>
                <option :value="3">{{ $t('preferences.markdown.lists.listIndentation.threeSpaces') }}</option>
                <option :value="4">{{ $t('preferences.markdown.lists.listIndentation.fourSpaces') }}</option>
              </select>
            </div>
          </div>
          <!-- Extensions -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.markdown.extensions.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.extensions.frontmatterType.title') }}</label>
              <select :value="prefs.frontmatterType" @change="set('frontmatterType', ($event.target as HTMLSelectElement).value)">
                <option value="-">YAML (---)</option>
                <option value="+">TOML (+++)</option>
                <option value=";">JSON (;</option>
                <option value="{">{{ $t('preferences.markdown.extensions.frontmatterType.jsonBrace') }}</option>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.extensions.superSubScript') }}</label>
              <input type="checkbox" :checked="prefs.superSubScript" @change="set('superSubScript', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.extensions.footnote') }}</label>
              <input type="checkbox" :checked="prefs.footnote" @change="set('footnote', $e($event))" />
            </div>
          </div>
          <!-- Compatibility -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.markdown.compatibility.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.compatibility.enableHtml') }}</label>
              <input type="checkbox" :checked="prefs.isHtmlEnabled" @change="set('isHtmlEnabled', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.compatibility.enableGitlab') }}</label>
              <input type="checkbox" :checked="prefs.isGitlabCompatibilityEnabled" @change="set('isGitlabCompatibilityEnabled', $e($event))" />
            </div>
          </div>
          <!-- Diagrams -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.markdown.diagrams.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.diagrams.sequenceTheme.title') }}</label>
              <select :value="prefs.sequenceTheme" @change="set('sequenceTheme', ($event.target as HTMLSelectElement).value)">
                <option value="hand">{{ $t('preferences.markdown.diagrams.sequenceTheme.handDrawn') }}</option>
                <option value="simple">{{ $t('preferences.markdown.diagrams.sequenceTheme.simple') }}</option>
              </select>
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.markdown.diagrams.plantumlServer.title') }}</label>
              <input type="text" :value="prefs.plantumlServer"
                @change="set('plantumlServer', ($event.target as HTMLInputElement).value)" class="text-input" />
            </div>
          </div>
          <!-- Markdown Misc -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.markdown.misc.title') }}</div>
            <div class="setting-row">
              <label>{{ $t('preferences.markdown.misc.preferHeadingStyle.title') }}</label>
              <select :value="prefs.preferHeadingStyle" @change="set('preferHeadingStyle', ($event.target as HTMLSelectElement).value)">
                <option value="atx">{{ $t('preferences.markdown.misc.preferHeadingStyle.atx') }}</option>
                <option value="setext">{{ $t('preferences.markdown.misc.preferHeadingStyle.setext') }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== SPELLING ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('spelling')">
          {{ $t('preferences.spellchecker.title') }}
          <span class="chevron" :class="{ open: expanded.spelling }">&#9654;</span>
        </div>
        <div v-show="expanded.spelling" class="group-content">
          <div class="sub-group">
            <div class="setting-row">
              <label>{{ $t('preferences.spellchecker.enableSpellChecking') }}</label>
              <input type="checkbox" :checked="prefs.spellcheckerEnabled" @change="set('spellcheckerEnabled', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.spellchecker.hideMarksForErrors') }}</label>
              <input type="checkbox" :checked="prefs.spellcheckerNoUnderline" @change="set('spellcheckerNoUnderline', $e($event))" />
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.spellchecker.defaultLanguage') }}</label>
              <select :value="prefs.spellcheckerLanguage" @change="set('spellcheckerLanguage', ($event.target as HTMLSelectElement).value)">
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="de-DE">Deutsch</option>
                <option value="fr-FR">Français</option>
                <option value="es-ES">Español</option>
                <option value="it-IT">Italiano</option>
                <option value="pt-BR">Português (BR)</option>
                <option value="nl-NL">Nederlands</option>
                <option value="ru-RU">Русский</option>
                <option value="zh-CN">中文</option>
                <option value="ja-JP">日本語</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== THEME ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('theme')">
          {{ $t('preferences.theme.title') }}
          <span class="chevron" :class="{ open: expanded.theme }">&#9654;</span>
        </div>
        <div v-show="expanded.theme" class="group-content">
          <!-- Theme Selection -->
          <div class="sub-group">
            <div class="setting-row stacked">
              <label>{{ $t('preferences.search.items.theme') }}</label>
              <select :value="prefs.theme" @change="set('theme', ($event.target as HTMLSelectElement).value)"
                :disabled="prefs.followSystemTheme" :class="{ disabled: prefs.followSystemTheme }">
                <optgroup :label="$t('preferences.general.misc.language.english') /* Light */">
                  <option value="light">Light</option>
                  <option value="graphite">Graphite</option>
                  <option value="ulysses">Ulysses</option>
                  <option value="ayu-light">Ayu Light</option>
                  <option value="catppuccin-latte">Catppuccin Latte</option>
                  <option value="everforest-light">Everforest Light</option>
                  <option value="gruvbox-light">Gruvbox Light</option>
                  <option value="rose-pine-dawn">Rose Pine Dawn</option>
                  <option value="solarized-light">Solarized Light</option>
                  <option value="tokyo-night-light">Tokyo Night Light</option>
                </optgroup>
                <optgroup label="Dark">
                  <option value="dark">Dark</option>
                  <option value="material-dark">Material Dark</option>
                  <option value="one-dark">One Dark</option>
                  <option value="ayu-dark">Ayu Dark</option>
                  <option value="ayu-mirage">Ayu Mirage</option>
                  <option value="catppuccin-mocha">Catppuccin Mocha</option>
                  <option value="cyberdream">Cyberdream</option>
                  <option value="dracula">Dracula</option>
                  <option value="everforest-dark">Everforest Dark</option>
                  <option value="gruvbox-dark">Gruvbox Dark</option>
                  <option value="horizon-dark">Horizon Dark</option>
                  <option value="kanagawa">Kanagawa</option>
                  <option value="monokai-pro">Monokai Pro</option>
                  <option value="nightfox">Nightfox</option>
                  <option value="nord">Nord</option>
                  <option value="oxocarbon-dark">Oxocarbon Dark</option>
                  <option value="palenight">Palenight</option>
                  <option value="rose-pine">Rose Pine</option>
                  <option value="rose-pine-moon">Rose Pine Moon</option>
                  <option value="solarized-dark">Solarized Dark</option>
                  <option value="synthwave-84">Synthwave '84</option>
                  <option value="tokyo-night">Tokyo Night</option>
                  <option value="tokyo-night-storm">Tokyo Night Storm</option>
                </optgroup>
              </select>
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.theme.followSystemTheme') }}</label>
              <input type="checkbox" :checked="prefs.followSystemTheme" @change="set('followSystemTheme', $e($event))" />
            </div>
          </div>
          <!-- Mode Themes (shown when Follow System is on) -->
          <div v-if="prefs.followSystemTheme" class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.theme.modeThemes') }}</div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.theme.lightModeTheme') }}</label>
              <select :value="prefs.lightModeTheme" @change="set('lightModeTheme', ($event.target as HTMLSelectElement).value)">
                <option v-for="t in lightThemes" :key="t" :value="t">{{ themeLabel(t) }}</option>
              </select>
            </div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.theme.darkModeTheme') }}</label>
              <select :value="prefs.darkModeTheme" @change="set('darkModeTheme', ($event.target as HTMLSelectElement).value)">
                <option v-for="t in darkThemes" :key="t" :value="t">{{ themeLabel(t) }}</option>
              </select>
            </div>
          </div>
          <!-- Custom CSS -->
          <div class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.theme.customCss') }}</div>
            <textarea class="custom-css-input" rows="6" :value="prefs.customCss"
              @change="set('customCss', ($event.target as HTMLTextAreaElement).value)"
              placeholder="Add custom CSS here..."></textarea>
          </div>
        </div>
      </div>

      <!-- ==================== IMAGE ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('image')">
          {{ $t('preferences.categories.image') }}
          <span class="chevron" :class="{ open: expanded.image }">&#9654;</span>
        </div>
        <div v-show="expanded.image" class="group-content">
          <div class="sub-group">
            <div class="setting-row stacked">
              <label>{{ $t('preferences.search.items.imageInsertAction') }}</label>
              <select :value="prefs.imageInsertAction" @change="set('imageInsertAction', ($event.target as HTMLSelectElement).value)">
                <option value="folder">{{ $t('preferences.image.actions.folder') }}</option>
                <option value="path">{{ $t('preferences.image.actions.path') }}</option>
                <option value="upload">{{ $t('preferences.image.actions.upload') }}</option>
              </select>
            </div>
          </div>
          <!-- Folder Settings (when action is folder or path) -->
          <div v-if="prefs.imageInsertAction === 'folder' || prefs.imageInsertAction === 'path'" class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.image.folderSetting.title') }}</div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.image.folderSetting.globalFolder') }}</label>
              <input type="text" :value="prefs.imageFolderPath"
                @change="set('imageFolderPath', ($event.target as HTMLInputElement).value)" class="text-input" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.image.folderSetting.preferRelative') }}</label>
              <input type="checkbox" :checked="prefs.imagePreferRelativeDirectory" @change="set('imagePreferRelativeDirectory', $e($event))" />
            </div>
            <div v-if="prefs.imagePreferRelativeDirectory" class="setting-row stacked">
              <label>{{ $t('preferences.image.folderSetting.relativeCopyLocation') }}</label>
              <select :value="prefs.imageRelativeDirectoryBase" @change="set('imageRelativeDirectoryBase', ($event.target as HTMLSelectElement).value)">
                <option value="file">{{ $t('preferences.image.folderSetting.copyRelativeToFile') }}</option>
                <option value="root">{{ $t('preferences.image.folderSetting.copyRelativeToFolder') }}</option>
              </select>
            </div>
            <div v-if="prefs.imagePreferRelativeDirectory" class="setting-row stacked">
              <label>{{ $t('preferences.image.folderSetting.relativeFolderName') }}</label>
              <input type="text" :value="prefs.imageRelativeDirectoryName"
                @change="set('imageRelativeDirectoryName', ($event.target as HTMLInputElement).value)" class="text-input" />
            </div>
          </div>
          <!-- Uploader (when action is upload) -->
          <div v-if="prefs.imageInsertAction === 'upload'" class="sub-group">
            <div class="sub-group-label">{{ $t('preferences.image.uploader.title') }}</div>
            <div class="setting-row stacked">
              <label>{{ $t('preferences.image.uploader.services.picgo') }}</label>
              <select :value="prefs.currentUploader" @change="set('currentUploader', ($event.target as HTMLSelectElement).value)">
                <option value="picgo">PicGo</option>
                <option value="piclist">PicList</option>
                <option value="custom">{{ $t('preferences.image.uploader.services.cliScript') }}</option>
              </select>
            </div>
            <div v-if="prefs.currentUploader === 'custom'" class="setting-row stacked">
              <label>{{ $t('preferences.image.uploader.scriptPath') }}</label>
              <input type="text" :value="prefs.cliScript"
                @change="set('cliScript', ($event.target as HTMLInputElement).value)" class="text-input" />
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== VIEW ==================== -->
      <div class="setting-group">
        <div class="group-label" @click="toggleSection('view')">
          {{ $t('preferences.categories.view') }}
          <span class="chevron" :class="{ open: expanded.view }">&#9654;</span>
        </div>
        <div v-show="expanded.view" class="group-content">
          <div class="sub-group">
            <div class="setting-row">
              <label>{{ $t('preferences.view.sideBar') }}</label>
              <input type="checkbox" :checked="prefs.sideBarVisibility" @change="set('sideBarVisibility', $e($event))" />
            </div>
            <div class="setting-row">
              <label>{{ $t('preferences.view.tabBar') }}</label>
              <input type="checkbox" :checked="prefs.tabBarVisibility" @change="set('tabBarVisibility', $e($event))" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { usePreferencesStore } from '@/store/preferences'
import { invoke } from '@tauri-apps/api/core'

const store = usePreferencesStore()
const prefs = store as unknown as Record<string, unknown>

// Helper: extract boolean from checkbox change event
const $e = (event: Event): boolean => (event.target as HTMLInputElement).checked

const set = (key: string, value: unknown): void => {
  store.SET_SINGLE_PREFERENCE({ type: key, value } as never)
}

// Collapsible sections — General and Editor open by default
const expanded = reactive<Record<string, boolean>>({
  general: true,
  editor: true,
  markdown: false,
  spelling: false,
  theme: false,
  image: false,
  view: false
})
const toggleSection = (name: string): void => {
  expanded[name] = !expanded[name]
}

// Zoom level options
const zoomLevels = [
  { label: '50%', value: 0.5 }, { label: '62.5%', value: 0.625 },
  { label: '75%', value: 0.75 }, { label: '87.5%', value: 0.875 },
  { label: '100%', value: 1.0 }, { label: '112.5%', value: 1.125 },
  { label: '125%', value: 1.25 }, { label: '137.5%', value: 1.375 },
  { label: '150%', value: 1.5 }, { label: '162.5%', value: 1.625 },
  { label: '175%', value: 1.75 }, { label: '187.5%', value: 1.875 },
  { label: '200%', value: 2.0 }
]

// Theme lists for light/dark mode selects
const lightThemes = [
  'light', 'graphite', 'ulysses', 'ayu-light', 'catppuccin-latte',
  'everforest-light', 'gruvbox-light', 'rose-pine-dawn', 'solarized-light', 'tokyo-night-light'
]
const darkThemes = [
  'dark', 'material-dark', 'one-dark', 'ayu-dark', 'ayu-mirage',
  'catppuccin-mocha', 'cyberdream', 'dracula', 'everforest-dark', 'gruvbox-dark',
  'horizon-dark', 'kanagawa', 'monokai-pro', 'nightfox', 'nord',
  'oxocarbon-dark', 'palenight', 'rose-pine', 'rose-pine-moon', 'solarized-dark',
  'synthwave-84', 'tokyo-night', 'tokyo-night-storm'
]

const themeLabel = (name: string): string => {
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// System font list (loaded once on mount)
const systemFonts = ref<string[]>([])
onMounted(async () => {
  try {
    systemFonts.value = await invoke<string[]>('fonts_list')
  } catch {
    systemFonts.value = []
  }
})
</script>

<style scoped>
.sidebar-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  user-select: none;
}

.settings-header {
  padding: 10px 16px;
  border-bottom: 1px solid var(--side-bar-border-color, #e0e0e0);
}

.settings-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--side-bar-title-color, #333);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.setting-group {
  margin-bottom: 2px;
}

.group-label {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--side-bar-group-color, #999);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-label:hover {
  color: var(--side-bar-color, #666);
}

.chevron {
  font-size: 8px;
  transition: transform 0.2s ease;
  display: inline-block;
}

.chevron.open {
  transform: rotate(90deg);
}

.group-content {
  padding-bottom: 4px;
}

.sub-group {
  margin-bottom: 6px;
  padding: 0 16px;
}

.sub-group-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--side-bar-group-color, #aaa);
  padding: 4px 0 2px;
  border-top: 1px solid var(--side-bar-border-color, rgba(0,0,0,0.06));
  margin-top: 2px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 12px;
  color: var(--side-bar-color, #333);
  gap: 8px;
}

.setting-row.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}

.setting-row.stacked label {
  font-size: 10px;
  color: var(--side-bar-group-color, #888);
  margin-bottom: 1px;
}

.setting-row label {
  flex: 1;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-row select {
  padding: 2px 4px;
  font-size: 11px;
  border: 1px solid var(--side-bar-border-color, #ccc);
  border-radius: 3px;
  background: var(--side-bar-input-bg, #fff);
  color: var(--side-bar-color, #333);
  cursor: pointer;
  max-width: 130px;
  min-width: 60px;
}

.setting-row select.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.number-input {
  width: 52px;
  padding: 2px 4px;
  font-size: 11px;
  border: 1px solid var(--side-bar-border-color, #ccc);
  border-radius: 3px;
  background: var(--side-bar-input-bg, #fff);
  color: var(--side-bar-color, #333);
}

.text-input {
  width: 100%;
  padding: 3px 6px;
  font-size: 11px;
  border: 1px solid var(--side-bar-border-color, #ccc);
  border-radius: 3px;
  background: var(--side-bar-input-bg, #fff);
  color: var(--side-bar-color, #333);
  box-sizing: border-box;
}

.range-input {
  width: 80px;
  height: 4px;
  cursor: pointer;
}

.range-value {
  font-size: 10px;
  color: var(--side-bar-group-color, #888);
  min-width: 32px;
  text-align: right;
}

.setting-row input[type='checkbox'] {
  width: 15px;
  height: 15px;
  cursor: pointer;
  flex-shrink: 0;
}

.custom-css-input {
  width: 100%;
  background: transparent;
  color: var(--editorColor);
  border: 1px solid var(--side-bar-border-color, #ccc);
  border-radius: 3px;
  padding: 6px 8px;
  font-family: 'DejaVu Sans Mono', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.4;
  box-sizing: border-box;
  resize: vertical;
}

.custom-css-input:focus {
  outline: none;
  border-color: var(--themeColor, #409eff);
}
</style>
