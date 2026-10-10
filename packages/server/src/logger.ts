import type { LogLevel } from "./config"

type Fields = Record<string, unknown>

export interface Logger {
   debug: (message: string, fields?: Fields) => void
   info: (message: string, fields?: Fields) => void
   warn: (message: string, fields?: Fields) => void
   error: (message: string, fields?: Fields) => void
}

const severity: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

/** Writes one JSON object per line to stdout. Callers must never pass secrets as fields. */
export function createLogger(level: LogLevel): Logger {
   function write(entryLevel: Exclude<LogLevel, "silent">, message: string, fields?: Fields): void {
      if (severity[entryLevel] < severity[level]) return
      const entry = { time: new Date().toISOString(), level: entryLevel, message, ...fields }
      process.stdout.write(`${JSON.stringify(entry)}\n`)
   }

   return {
      debug: (message, fields) => write("debug", message, fields),
      info: (message, fields) => write("info", message, fields),
      warn: (message, fields) => write("warn", message, fields),
      error: (message, fields) => write("error", message, fields)
   }
}

export function describeError(error: unknown): Fields {
   if (error instanceof Error) return { error: error.message, stack: error.stack }
   return { error: String(error) }
}
