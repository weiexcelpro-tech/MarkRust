

# markrust

> MarkText(https://github.com/marktext/marktext) rewritten with **Tauri 2 + Rust main process**, reusing the Vue 3 renderer and muya engine.

**Current release: v1.0.0** — See [Releases](https://github.com/weiexcelpro-tech/markrust/releases).
Just test on Windows 11. Here is Typora on MacOS.

## v1.0.0 Release Notes

- **Cursor drift fix (K V6.1)**: Continuous typing no longer causes cursor jumps. Root-caused to async DOM normalization clobbering the selection after `innerHTML` re-render; fixed with a rAF guard + direction-aware denormalization strategy in `inlineRenderer/index.ts`.
- **Right-click context menu**: Full DOM popup menu (insert paragraph / cut / copy / paste / copy as rich text / copy as HTML / paste as plain text) wired through `tauri-bridge.ts` → `localEmit('mt::menu::click')`.
- **Automated tests**: 6 PASS / 1 FAIL / 5 SKIP — all failures are environment-only (clipboard inaccessible while screen locked), not code bugs.
- **Binary size**: 11.56 MB standalone `markrust.exe` (no runtime dependency).

## Status: Phase 0-7 Complete

| Phase | Status | Description |
|---|---|---|
| 0 | ✅ | Tauri 2 + Vue3 + TS scaffold |
| 1 | ✅ | File IO + ripgrep (803 lines, 21 commands) |
| 2 | ✅ | Window + menu + dialog (11 commands + 5 submenus) |
| 3 | ✅ | IPC mapping (16 commands: clipboard/shell/misc/fonts/i18n) |
| 4 | ✅ | Native module replacement (11 commands: keyboard/spellchecker/updater/secure) |
| 5 | ✅ | Preferences + update check (6 commands) |
| 6a | ✅ | NSIS packaging config |
| 6b | ✅ | Rust unit tests (52 passed, 0 failed, 4 ignored) |
| 6c | ✅ | Frontend renderer integration + cursor drift fix + context menu fix |
| 7 | ✅ | Release v1.0.0 |

**Rust backend**: 65 invoke commands, 100% complete  
**Frontend**: vite build passes, runtime verified, all reported regressions fixed

Full plan: [`../.sisyphus/plans/tauri-migration.md`](../.sisyphus/plans/tauri-migration.md)

## Prerequisites

- Rust 1.77+ (cargo)
- Node.js 20+
- pnpm 10+
- Windows 10/11 with WebView2 runtime

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
# Frontend only (vite build)
pnpm build

# Full Tauri build (produces NSIS installer)
pnpm tauri build

# Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml
```

## Architecture

```
marktext-tauri/
├── src-tauri/              Rust main process
│   ├── src/
│   │   ├── lib.rs          Command registration (65 commands)
│   │   ├── error.rs        Unified AppError type
│   │   └── commands/
│   │       ├── fs.rs       16 file system commands
│   │       ├── encoding.rs BOM + chardetng + encoding_rs
│   │       ├── watcher.rs  notify-debouncer file watching
│   │       ├── ripgrep.rs  Streaming rg search
│   │       ├── window.rs   6 window commands
│   │       ├── dialog.rs   5 dialog commands
│   │       ├── menu.rs     5 submenus + event routing
│   │       ├── clipboard.rs 3 clipboard commands
│   │       ├── shell.rs    3 shell commands
│   │       ├── misc.rs     6 misc commands
│   │       ├── fonts.rs    Windows font registry query
│   │       ├── i18n.rs     10 embedded locales
│   │       ├── keyboard.rs Keyboard layout info
│   │       ├── spellchecker.rs Custom dictionary
│   │       ├── uploader.rs Picgo/CLI image upload
│   │       ├── secure.rs   keyring credential storage
│   │       ├── preferences.rs Preference persistence
│   │       └── updater.rs  GitHub API update check
│   ├── resources/
│   │   ├── preferences-default.json
│   │   ├── preferences-schema.json
│   │   └── i18n/*.json     10 language files
│   └── Cargo.toml
├── src/
│   ├── renderer/src/       Vue 3 application (208 files)
│   │   ├── tauri-bridge.ts Electron→Tauri API adapter (10 window.* objects)
│   │   ├── shims/          Electron package shims
│   │   ├── main.ts         App entry
│   │   └── bootstrap.ts    Init + error handling
│   ├── common/             Shared utilities
│   └── shared/             Cross-process types
├── packages/muya/src/      Editor engine (602 files, with perf fixes)
└── vite.config.ts
```

## Key Design Decisions

1. **Hybrid approach**: Rust main process + reused Vue3 renderer + reused muya + Tauri 2 Shell
2. **No code signing**: Open source, releases via GitHub Releases
3. **AI-driven development**: No Rust training budget
4. **Independent repo**: One-time asset fork from marktext-develop
5. **Manual update check**: tauri-plugin-updater requires signing; use GitHub API + semver instead
6. **font-kit avoidance**: Windows registry query (zero new dependency)
7. **i18n embedding**: `include_str!` compile-time embedding
