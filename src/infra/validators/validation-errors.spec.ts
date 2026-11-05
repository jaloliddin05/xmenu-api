import {
  ArrayMinSize,
  IsIn,
  IsInt,
  Matches,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppException } from 'src/infra/errors/app-exception';
import {
  createValidationPipe,
  fieldCode,
  flattenValidationErrors,
} from './validation-errors';

class Theme {
  @Matches(/^#[0-9a-f]{6}$/i, { message: 'brand must be a hex color' })
  brand: string;
}
class Point {
  @Max(90) lat: number;
}
class Body {
  @ValidateNested() @Type(() => Theme) theme: Theme;
  @ArrayMinSize(1)
  @IsIn(['ru', 'uz', 'en'], { each: true })
  languages: string[];
  @ValidateNested({ each: true }) @Type(() => Point) points: Point[];
  @IsInt() @Max(21) zoom: number;
}

const transform = (value: unknown) =>
  createValidationPipe().transform(value, { type: 'body', metatype: Body });

describe('validation errors', () => {
  it('names nested fields, array items and the failed constraint', async () => {
    const err = await transform({
      theme: { brand: 'red' },
      languages: ['kk'],
      points: [{ lat: 10 }, { lat: 91 }],
      zoom: 1.5,
      extra: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    const body = (err as AppException).getResponse() as Record<string, any>;
    expect(body.code).toBe('validation_error');
    expect(body.fields).toEqual(
      expect.arrayContaining([
        {
          field: 'theme.brand',
          code: 'matches',
          message: 'brand must be a hex color',
        },
        expect.objectContaining({ field: 'languages', code: 'is_in' }),
        expect.objectContaining({ field: 'points[1].lat', code: 'max' }),
        expect.objectContaining({ field: 'zoom', code: 'is_int' }),
        expect.objectContaining({
          field: 'extra',
          code: 'unknown_field',
        }),
      ]),
    );
    expect(body.message).toContain('theme.brand: brand must be a hex color');
  });

  it('turns constraint names into snake_case field codes', () => {
    expect(fieldCode('isIn')).toBe('is_in');
    expect(fieldCode('maxLength')).toBe('max_length');
    expect(fieldCode('max')).toBe('max');
    expect(fieldCode('whitelistValidation')).toBe('unknown_field');
  });

  it('flattens an empty list to nothing', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });
});
