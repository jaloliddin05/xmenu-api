/** Text of anything a `catch` or an event handler may receive, for log lines. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Stack of an Error (falls back to its message / the value itself), for log lines. */
export function errorStack(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
