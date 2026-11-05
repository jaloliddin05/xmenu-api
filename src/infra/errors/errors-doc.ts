import { ERROR_CODES, ERROR_CODE_LIST, ErrorCodeSpec } from './error-codes';

const cell = (text: string) => text.replace(/\|/g, '\\|');

/** docs/ERRORS.md, generated from ERROR_CODES by npm run openapi. */
export function renderErrorsMarkdown(): string {
  const rows = ERROR_CODE_LIST.map((code) => {
    const spec: ErrorCodeSpec = ERROR_CODES[code];
    const extra = [
      spec.fields ? '`fields`' : '',
      spec.retryAfter ? '`retryAfter`' : '',
      ...(spec.details ?? []).map((k) => `\`details.${k}\``),
    ].filter(Boolean);
    const name = spec.deprecated
      ? `~~\`${code}\`~~ устарел → \`${spec.deprecated}\``
      : `\`${code}\``;
    return `| ${name} | ${spec.status} | ${cell(spec.when)} | ${extra.join(', ') || '—'} |`;
  });
  return [
    '# Коды ошибок',
    '',
    'Файл генерируется из `src/infra/errors/error-codes.ts` командой `npm run openapi`; руками не правится.',
    'Форма ответа, правила и `platform_misconfigured`: `docs/API.md`, «Ошибки».',
    '',
    'Коды не переименовываются и не используются повторно. Новый смысл получает новый код, старый',
    'помечается устаревшим (зачёркнут, указана замена) и больше не отдаётся.',
    '',
    '| Код | HTTP | Когда | Дополнительно |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
