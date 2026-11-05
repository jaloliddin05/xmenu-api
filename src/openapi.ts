/**
 * Writes docs/openapi.json from the controllers and DTOs, the same document /docs serves, and
 * docs/ERRORS.md from the error code registry.
 * Runs from the compiled build (npm run openapi = nest build + this file), because parameter types
 * come from tsc decorator metadata. Needs no Postgres or Redis: preview mode builds the module
 * graph without instantiating providers.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './swagger';
import { renderErrorsMarkdown } from './infra/errors/errors-doc';

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
  await app.close();
  console.log(
    `openapi: ${Object.keys(document.paths).length} paths -> docs/openapi.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
