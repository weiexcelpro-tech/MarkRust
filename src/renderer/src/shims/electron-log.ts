// electron-log/renderer shim：bootstrap.ts 仅使用 `log.transports.console.level` 控制级别，
// 并把 `log.error` 赋给 exceptionLogger。此 shim 用 console API 复刻该契约。

type Level = 'silly' | 'verbose' | 'debug' | 'info' | 'warn' | 'error' | false

const PRIORITY: Record<Exclude<Level, false>, number> = {
  silly: 10,
  verbose: 20,
  debug: 30,
  info: 40,
  warn: 50,
  error: 60
}

let current: Level = 'info'

const should = (lv: Exclude<Level, false>): boolean =>
  current !== false && PRIORITY[lv] >= PRIORITY[current]

const emit = (lv: Exclude<Level, false>, fn: (...a: unknown[]) => void, ...a: unknown[]): void => {
  if (should(lv)) fn(...a)
}

const transport = {
  get level(): Level {
    return current
  },
  set level(v: Level) {
    current = v
  }
}

const logger = {
  transports: { console: transport, file: transport },
  info: (...a: unknown[]) => emit('info', console.info, ...a),
  warn: (...a: unknown[]) => emit('warn', console.warn, ...a),
  error: (...a: unknown[]) => emit('error', console.error, ...a),
  debug: (...a: unknown[]) => emit('debug', console.debug, ...a),
  verbose: (...a: unknown[]) => emit('verbose', console.debug, ...a),
  silly: (...a: unknown[]) => emit('silly', console.debug, ...a),
  log: (...a: unknown[]) => emit('info', console.log, ...a)
}

export default logger
export const log = logger
export const transports = logger.transports
