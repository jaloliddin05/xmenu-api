import { join } from 'path';
import { BOT_TEXT_FILES, scanSource, textProblems } from './user-texts';

const problems = (file: string, source: string) =>
  scanSource(file, source).map((f) => `${f.line}: ${f.problem}`);

describe('textProblems', () => {
  it.each([
    ['PUBLIC_API_URL must be https', 'environment variable name'],
    ['failed in src/modules/x/y.ts', 'file path'],
    ['see dist/main.js', 'file path'],
    ['C:\\Users\\me\\.env', 'file path'],
    ['Error\n    at Foo (/app/x.js:1:2)', 'stack trace'],
    ['TypeError: cannot read', 'stack trace'],
  ])('finds %j', (text, problem) => {
    expect(textProblems(text)).toContain(problem);
  });

  it('flags Cyrillic only in error messages', () => {
    expect(textProblems('Заказ принят', true)).toEqual(['not English']);
    expect(textProblems('Заказ принят')).toEqual([]);
  });

  it.each([
    'Telegram did not accept the bot token',
    'quantity must be 1..99',
    'This feature is not configured on the platform',
    'Order No. 12 is on the way',
    'https://t.me/venue_bot',
    'xmenu.uz',
  ])('passes %j', (text) => {
    expect(textProblems(text, true)).toEqual([]);
  });
});

describe('scanSource', () => {
  it('checks every string of an exception, including object messages and templates', () => {
    const src = [
      "throw new BadRequestException({ code: 'x', message: 'PUBLIC_API_URL is not https' });",
      "throw new CustomerAuthException('x', `Kod ${n} xato: заказ`);",
      "throw new ServiceUnavailableException('Provider is down');",
    ].join('\n');
    expect(problems('src/a.ts', src)).toEqual([
      '1: environment variable name',
      '2: not English',
    ]);
  });

  it('flags an exception or service text put into a response', () => {
    const src = [
      'throw new BadGatewayException({ message: e.message });',
      'throw new AppException("x", { message: `failed: ${errorMessage(err)}` });',
      "return { status: 'failed', reason: telegramErrorText(e) };",
    ].join('\n');
    expect(problems('src/a.ts', src)).toEqual([
      '1: error text in a response',
      '2: error text in a response',
      '3: error text outside a log line',
    ]);
  });

  it('allows error texts in log lines and in the allowed files', () => {
    const src = [
      'this.logger.warn(`setWebhook failed: ${telegramErrorText(e)}`);',
      'console.error(errorMessage(e));',
      "Logger.error('x', errorStack(e));",
    ].join('\n');
    expect(problems('src/a.ts', src)).toEqual([]);
    expect(
      problems(
        'src/modules/payment/services/refund.processor.ts',
        'void ops.send(`Refund failed: ${errorMessage(err)}`);',
      ),
    ).toEqual([]);
  });

  it('checks field errors', () => {
    expect(
      problems(
        'src/a.ts',
        "errors.push({ field: 'menu', reason: 'x', message: 'DELIVERY_URL_TEMPLATE is unset' });",
      ),
    ).toEqual(['1: environment variable name']);
  });

  it('checks every string of a bot text file, but not imports, keys or log lines', () => {
    const src = [
      "import { X } from 'src/modules/x/x.ts';",
      "const KEYS = { 'ORDER_KEY': 1 };",
      "this.logger.warn('OTP_BOT is unset');",
      "export const greeting = 'Set OTP_BOT first';",
      "export const ok = 'Добро пожаловать';",
    ].join('\n');
    expect(problems(BOT_TEXT_FILES[0], src)).toEqual([
      '4: environment variable name',
    ]);
    // the same strings outside an exception or a bot file are not texts
    expect(problems('src/a.ts', src)).toEqual([]);
  });

  it('knows the real bot text files', () => {
    for (const f of BOT_TEXT_FILES)
      expect(() =>
        require.resolve(join(__dirname, '..', '..', '..', f)),
      ).not.toThrow();
  });
});
