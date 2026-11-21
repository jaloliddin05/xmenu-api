import { swaggerEnabled } from './swagger';

describe('swaggerEnabled', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{}, true],
    [{ NODE_ENV: 'test' }, true],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'yes' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }, true],
  ])('%j → %s', (env, expected) => {
    expect(swaggerEnabled(env)).toBe(expected);
  });
});
