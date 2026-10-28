import { PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { ApplicationController } from './application.controller';

describe('ApplicationController access', () => {
  const proto = ApplicationController.prototype;

  it('keeps POST public (landing contact form)', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, proto.create)).toBe(true);
  });

  it('GET is not public and requires the platform admin guard', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, proto.findAll)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', proto.findAll)).toContain(PlatformAdminGuard);
  });
});
