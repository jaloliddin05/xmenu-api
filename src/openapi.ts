/**
 * Writes docs/openapi.json from the controllers and DTOs, the same document /docs serves,
 * docs/ERRORS.md from the error code registry and the access matrix in docs/API.md from the routes' rules.
 * Runs from the compiled build (npm run openapi = nest build + this file), because parameter types
 * come from tsc decorator metadata. Needs no Postgres or Redis: preview mode builds the module
 * graph without instantiating providers.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './swagger';
import { renderErrorsMarkdown } from './infra/errors/errors-doc';
import {
  collectRoutes,
  renderAccessMatrix,
} from './modules/auth/access/route-rules';

const MATRIX_START = '<!-- access-matrix:start (npm run openapi) -->';
const MATRIX_END = '<!-- access-matrix:end -->';

/** Replaces the generated access matrix between the markers in docs/API.md. */
function writeAccessMatrix(file: string, matrix: string) {
  const text = readFileSync(file, 'utf-8');
  const start = text.indexOf(MATRIX_START);
  const end = text.indexOf(MATRIX_END);
  if (start < 0 || end < start)
    throw new Error(`access matrix markers not found in ${file}`);
  writeFileSync(
    file,
    text.slice(0, start + MATRIX_START.length) +
      '\n' +
      matrix +
      '\n' +
      text.slice(end),
  );
}

async function main() {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: ['error'],
  });
  const document = createOpenApiDocument(app);
  const out = join(__dirname, '..', 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  writeFileSync(
    join(__dirname, '..', 'docs', 'ERRORS.md'),
    renderErrorsMarkdown(),
  );
  writeAccessMatrix(
    join(__dirname, '..', 'docs', 'API.md'),
    renderAccessMatrix(collectRoutes(app)),
  );
  await app.close();
  console.log(
    `openapi: ${Object.keys(document.paths).length} paths -> docs/openapi.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
