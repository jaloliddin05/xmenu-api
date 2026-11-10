/** Text of anything a `catch` or an event handler may receive, for log lines. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Stack of an Error (falls back to its message / the value itself), for log lines. */
export function errorStack(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/** Hides phone numbers in a log text: keeps the first 3 and last 2 digits of every run of 9+ digits (not inside ids such as a UUID). */
export function maskPhones(text: string): string {
  return text.replace(/(?<![\w-])\+?\d(?:[\s()-]?\d){8,}(?![\w-])/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return `${m.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}${'*'.repeat(digits.length - 5)}${digits.slice(-2)}`;
  });
}
