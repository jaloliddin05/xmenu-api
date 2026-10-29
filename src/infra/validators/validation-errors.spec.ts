import { ArrayMinSize, IsIn, IsInt, Matches, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe, flattenValidationErrors } from './validation-errors';

class Theme {
  @Matches(/^#[0-9a-f]{6}$/i, { message: 'brand must be a hex color' }) brand: string;
}
class Point {
  @Max(90) lat: number;
}
class Body {
  @ValidateNested() @Type(() => Theme) theme: Theme;
  @ArrayMinSize(1) @IsIn(['ru', 'uz', 'en'], { each: true }) languages: string[];
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
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as Record<string, any>;
    expect(body.code).toBe('validation_error');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        { field: 'theme.brand', reason: 'matches', message: 'brand must be a hex color' },
        expect.objectContaining({ field: 'languages', reason: 'isIn' }),
        expect.objectContaining({ field: 'points[1].lat', reason: 'max' }),
        expect.objectContaining({ field: 'zoom', reason: 'isInt' }),
        expect.objectContaining({ field: 'extra', reason: 'whitelistValidation' }),
      ]),
    );
    expect(body.message).toContain('theme.brand: brand must be a hex color');
  });

  it('flattens an empty list to nothing', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });
});
