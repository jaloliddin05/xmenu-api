import { BadRequestException } from '@nestjs/common';
import { OptionalBoolPipe } from './optional-bool.pipe';

describe('OptionalBoolPipe', () => {
  const pipe = new OptionalBoolPipe('is_active');
  it('maps absent/empty to undefined and true/false to booleans', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
    expect(pipe.transform('')).toBeUndefined();
    expect(pipe.transform('true')).toBe(true);
    expect(pipe.transform('false')).toBe(false);
  });
  it.each(['1', 'TRUE', 'yes', 'null', '[object Object]'])('rejects %s with 400', (v) => {
    expect(() => pipe.transform(v)).toThrow(BadRequestException);
  });
});
