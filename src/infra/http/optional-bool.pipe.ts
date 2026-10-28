import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Optional boolean query parameter: absent/empty -> undefined, 'true'/'false' -> boolean, anything else -> 400. */
@Injectable()
export class OptionalBoolPipe implements PipeTransform<string | undefined, boolean | undefined> {
  constructor(private readonly name = 'value') {}

  transform(value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException(`${this.name} must be "true" or "false"`);
  }
}
