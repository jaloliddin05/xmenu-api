import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

/**
 * npm run check:user-texts: texts that can reach an owner, a customer or a guest must not carry
 * environment variable names, file paths, stack traces or the text of an exception / an external
 * service. Checked statically:
 * - every string inside `new …Exception(…)` and every `{ field, message }` object (error messages:
 *   also English only);
 * - every string of the bot and SMS text files (BOT_TEXT_FILES);
 * - errorMessage / errorStack / telegramErrorText outside a logger call (an error text sent onwards).
 */

export interface Finding {
  file: string;
  line: number;
  problem: string;
  text: string;
}

/** Bot messages, bot profile defaults and SMS texts. */
export const BOT_TEXT_FILES = [
  'src/modules/auth/services/telegram-verification.messages.ts',
  'src/modules/order/notifications/order-messages.ts',
  'src/modules/telegram/domain/bot-profile.ts',
  'src/modules/auth/services/customer-otp.service.ts',
];

/**
 * Files allowed to pass an error text on, with the reason. The ops chat is the platform's own
 * operators, not an owner, a customer or a guest.
 */
export const ERROR_TEXT_ALLOWED: Record<string, string> = {
  'src/modules/payment/services/refund.processor.ts':
    'refund failures go to the platform ops chat',
  'src/modules/order/notifications/ops-notifier.service.ts':
    'platform ops chat',
};

const ERROR_TEXT_FUNCTIONS = new Set([
  'errorMessage',
  'errorStack',
  'telegramErrorText',
]);

const PATTERNS: { problem: string; re: RegExp; errorsOnly?: boolean }[] = [
  {
    problem: 'environment variable name',
    re: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/,
  },
  {
    problem: 'file path',
    re: /(?:^|[\s'"`(=])\.{0,2}\/?(?:src|dist|node_modules)\/|\b[\w-]+\.(?:ts|js|mjs|cjs)\b|[A-Za-z]:\\|(?:^|\s)\.env\b|\/(?:home|usr|var|etc|opt|root)\//,
  },
  {
    problem: 'stack trace',
    re: /\n\s+at\s|\bat\s+\S+\s+\([^)]*:\d+:\d+\)|\b[A-Z][A-Za-z]*Error:\s/,
  },
  { problem: 'not English', re: /[Ѐ-ӿ]/, errorsOnly: true },
];

/** Problems of one text. `errorMessage`: the text is an error message (English only). */
export function textProblems(text: string, errorMessage = false): string[] {
  return PATTERNS.filter(
    (p) => (errorMessage || !p.errorsOnly) && p.re.test(text),
  ).map((p) => p.problem);
}

/** Literal text of a string or template node (template parts joined with `…`). */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map((s) => s.literal.text),
    ].join('…');
  return null;
}

const isLoggerCall = (node: ts.CallExpression) => {
  const callee = node.expression.getText();
  return /(^|\.)(logger|Logger|console)\.\w+$/.test(callee);
};

/** The value is an exception's text or stack (`e.message`, `err.stack`, errorMessage(e)…). */
function isErrorText(node: ts.Node): boolean {
  if (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === 'message' || node.name.text === 'stack') &&
    /^(e|err|error|exception|cause)$/.test(node.expression.getText())
  )
    return true;
  if (
    ts.isCallExpression(node) &&
    ERROR_TEXT_FUNCTIONS.has(node.expression.getText())
  )
    return true;
  return false;
}

const isDirectString = (node: ts.Node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

/** Skips strings that are not texts: imports, keys, types, enum-like comparisons. */
function isTextPosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return false;
  if (ts.isLiteralTypeNode(p)) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return false;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node)
    return false;
  return true;
}

export function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const isBotTextFile = BOT_TEXT_FILES.includes(file);
  const allowErrorText = file in ERROR_TEXT_ALLOWED;

  const report = (node: ts.Node, problem: string, text: string) =>
    findings.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      problem,
      text: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    });

  const checkText = (node: ts.Node, errorMessage: boolean) => {
    const text = literalText(node);
    if (text === null) return;
    for (const problem of textProblems(text, errorMessage))
      report(node, problem, text);
  };

  /** Every string and error text inside an exception's arguments or a field error. */
  const checkErrorPayload = (root: ts.Node) => {
    const walk = (node: ts.Node) => {
      if (isDirectString(node) && isTextPosition(node)) checkText(node, true);
      if (isErrorText(node))
        report(node, 'error text in a response', node.getText(sf));
      ts.forEachChild(node, walk);
    };
    walk(root);
  };

  const insideLogger = (node: ts.Node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && isLoggerCall(p)) return true;
      if (ts.isFunctionLike(p)) return false;
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      /Exception$/.test(node.expression.getText(sf))
    ) {
      node.arguments?.forEach(checkErrorPayload);
      return;
    }
    if (
      ts.isObjectLiteralExpression(node) &&
      ['field', 'message'].every((k) =>
        node.properties.some(
          (p) => p.name && ts.isIdentifier(p.name) && p.name.text === k,
        ),
      )
    ) {
      checkErrorPayload(node);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ERROR_TEXT_FUNCTIONS.has(node.expression.getText(sf)) &&
      !allowErrorText &&
      !insideLogger(node)
    ) {
      report(node, 'error text outside a log line', node.getText(sf));
    }
    if (
      isBotTextFile &&
      isDirectString(node) &&
      isTextPosition(node) &&
      !insideLogger(node)
    ) {
      checkText(node, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.ts$/.test(f) && !/\.(spec|fake)\.ts$/.test(f) ? [p] : [];
  });
}

/** Scans `src` of the repository at `root` (this checker itself is skipped). */
export function scanProject(root: string): Finding[] {
  return sourceFiles(join(root, 'src'))
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((f) => !f.startsWith('src/tools/user-texts/'))
    .flatMap((f) => scanSource(f, readFileSync(join(root, f), 'utf-8')));
}
