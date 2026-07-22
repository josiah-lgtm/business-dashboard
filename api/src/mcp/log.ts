// Thin logging shim so the MCP modules don't each need a FastifyBaseLogger
// threaded through them. server.ts calls setLogger(app.log) at boot; before
// that (and in unit tests) it degrades to console.
type Fields = Record<string, unknown>

interface Sink {
  info(obj: Fields, msg?: string): void
  warn(obj: Fields, msg?: string): void
  error(obj: Fields, msg?: string): void
}

const consoleSink: Sink = {
  info: (o, m) => console.log('[mcp]', m ?? '', o),
  warn: (o, m) => console.warn('[mcp]', m ?? '', o),
  error: (o, m) => console.error('[mcp]', m ?? '', o),
}

let sink: Sink = consoleSink

export function setLogger(l: Sink): void {
  sink = l
}

export const log = {
  info: (msg: string, fields: Fields = {}) => sink.info({ mcp: true, ...fields }, msg),
  warn: (msg: string, fields: Fields = {}) => sink.warn({ mcp: true, ...fields }, msg),
  error: (msg: string, fields: Fields = {}) => sink.error({ mcp: true, ...fields }, msg),
}

/** Turn any thrown value into a clean one-line message. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
