import { readFileSync } from 'fs';
import { join } from 'path';

// docs/openapi.json is generated (npm run openapi) and CI checks it is up to date, so this
// guards the shape of the documented error responses.
const doc = JSON.parse(
  readFileSync(join(__dirname, '..', 'docs', 'openapi.json'), 'utf-8'),
);
const ERROR_REF = '#/components/schemas/ErrorResponseDto';

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

  it('the error schema carries code, errors[] and retryAfter', () => {
    const props = doc.components.schemas.ErrorResponseDto.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'status',
        'code',
        'message',
        'errors',
        'retryAfter',
      ]),
    );
    expect(doc.components.schemas.ErrorResponseDto.required).toEqual(
      expect.arrayContaining(['code', 'message']),
    );
  });
});
