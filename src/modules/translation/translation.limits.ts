const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** Max characters of text sent to the model (TRANSLATION_MAX_TEXT, default 2000). Read at startup by the DTO. */
export const translationMaxText = () => num(process.env.TRANSLATION_MAX_TEXT, 2000);
/** Requests per client IP across all owners (TRANSLATION_IP_RATE_LIMIT / TRANSLATION_IP_RATE_WINDOW_SECONDS, default 60 / 600 s). */
export const translationIpRate = () => ({
  limit: num(process.env.TRANSLATION_IP_RATE_LIMIT, 60),
  ttlSeconds: num(process.env.TRANSLATION_IP_RATE_WINDOW_SECONDS, 600),
});
/** Requests per owner per window (TRANSLATION_RATE_LIMIT / TRANSLATION_RATE_WINDOW_SECONDS, default 30 / 600 s). */
export const translationRate = () => ({
  limit: num(process.env.TRANSLATION_RATE_LIMIT, 30),
  ttlSeconds: num(process.env.TRANSLATION_RATE_WINDOW_SECONDS, 600),
});
