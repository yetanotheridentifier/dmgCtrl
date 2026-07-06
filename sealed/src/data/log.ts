/**
 * Minimal diagnostic log. Entries mirror to the devtools console with a
 * `[sealed]` prefix and are kept in a capped in-memory buffer reachable from
 * the console as `window.__sealedLogs()` — see docs/operations.md.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  at: number
  level: LogLevel
  message: string
  detail?: unknown
}

const MAX_ENTRIES = 200
let buffer: LogEntry[] = []

function write(level: LogLevel, message: string, detail?: unknown) {
  buffer.push({ at: Date.now(), level, message, ...(detail !== undefined && { detail }) })
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES)
  console[level]('[sealed]', message, detail ?? '')
}

export const logger = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
}

export function getLogs(): LogEntry[] {
  return [...buffer]
}

export function clearLogs(): void {
  buffer = []
}

declare global {
  interface Window {
    __sealedLogs: () => LogEntry[]
  }
}

if (typeof window !== 'undefined') {
  window.__sealedLogs = getLogs
}
