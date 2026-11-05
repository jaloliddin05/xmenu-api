import { readFileSync } from 'fs';
import { join } from 'path';
import { ERROR_CODE_LIST } from './infra/errors/error-codes';
import { renderErrorsMarkdown } from './infra/errors/errors-doc';

// docs/openapi.json is generated (npm run openapi) and CI checks it is up to date, so this
// guards the shape of the documented error responses.
const doc = JSON.parse(
  readFileSync(join(__dirname, '..', 'docs', 'openapi.json'), 'utf-8'),
);
const ERROR_REF = '#/components/schemas/ErrorResponse';

const schemaOf = (path: string, method: string, status: string) =>
  doc.paths[path]?.[method]?.responses?.[status]?.content?.['application/json']
    ?.schema;

describe('openapi: error responses', () => {
  it('POST /application documents 400 and 429 with the error schema', () => {
    expect(schemaOf('/application', 'post', '400')).toEqual({
      $ref: ERROR_REF,
    });
    expect(schemaOf('/application', 'post', '429')).toEqual({
      $ref: ERROR_REF,
    });
  });

  it.each([
    ['/organization/{id}/publication', 'get'],
    ['/organization/{id}/channels', 'put'],
    ['/organization/{id}/publish', 'post'],
    ['/organization/{id}/unpublish', 'post'],
  ])(
    '%s %s documents 401, 403 and 404 with the error schema',
    (path, method) => {
      for (const status of ['401', '403', '404']) {
        expect(schemaOf(path, method, status)).toEqual({ $ref: ERROR_REF });
      }
    },
  );

  it('PUT channels: 400 and 422; publish: 409', () => {
    expect(schemaOf('/organization/{id}/channels', 'put', '400')).toEqual({
      $ref: ERROR_REF,
    });
    expect(schemaOf('/organization/{id}/channels', 'put', '422')).toBeDefined();
    expect(schemaOf('/organization/{id}/publish', 'post', '409')).toBeDefined();
  });

  it('the error schema: code from the registry, fields[], retryAfter, details, requestId', () => {
    const schema = doc.components.schemas.ErrorResponse;
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        'code',
        'details',
        'fields',
        'message',
        'requestId',
        'retryAfter',
        'status',
      ].sort(),
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(['code', 'message', 'status', 'requestId']),
    );
    expect(doc.components.schemas.ErrorCode.enum).toEqual(ERROR_CODE_LIST);
    expect(
      Object.keys(doc.components.schemas.FieldErrorDto.properties).sort(),
    ).toEqual(['code', 'field', 'message']);
  });

  it('every operation documents the error shape as its default response', () => {
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      for (const method of Object.keys(item)) {
        expect([path, method, schemaOf(path, method, 'default')]).toEqual([
          path,
          method,
          { $ref: ERROR_REF },
        ]);
      }
    }
  });
});

describe('docs/ERRORS.md', () => {
  it('is generated from the registry (npm run openapi)', () => {
    const md = readFileSync(
      join(__dirname, '..', 'docs', 'ERRORS.md'),
      'utf-8',
    );
    expect(md).toBe(renderErrorsMarkdown());
    for (const code of ERROR_CODE_LIST) expect(md).toContain(`\`${code}\``);
  });
});
