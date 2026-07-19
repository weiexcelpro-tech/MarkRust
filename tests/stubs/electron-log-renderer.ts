// Test stub for electron-log/renderer (uninstalled in dev).
// Provides the minimal surface bootstrap.ts touches: transports.console.level
// (assigned at runtime) and log.error (used as exceptionLogger).
export default {
  transports: {
    console: {
      level: 'info',
    },
    file: {
      level: 'info',
    },
  },
  error: (_msg: unknown): void => {},
  warn: (_msg: unknown): void => {},
  info: (_msg: unknown): void => {},
  log: (_msg: unknown): void => {},
}
