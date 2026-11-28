import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument, swaggerEnabled } from './swagger';
import { AppModule } from './app.module';
import { configureStatic } from './infra/http/static-assets';
import { configureErrorHandling } from './infra/errors/configure';
import { AccessTokenUserGuard } from './modules/auth/passport-strategies/access-token-user/access-token-user.guard';
import { StaffAccessGuard } from './modules/auth/access/staff-access.guard';
import { StepUpGuard } from './modules/auth/step-up/step-up.guard';
import { StepUpTokenService } from './modules/auth/step-up/step-up-token.service';
import { StepUpAuditInterceptor } from './modules/auth/step-up/step-up-audit.interceptor';
import { OwnerSecurityNotifier } from './modules/auth/step-up/owner-security-notifier.service';
import { checkEnvAtStartup } from './config/env/startup-check';
import { parseTrustProxy } from './infra/http/trust-proxy';
import { LiveMutationInterceptor } from './modules/live/live-mutation.interceptor';
import { LiveEventBus } from './modules/live/live-event-bus';
import { RevalidateService } from './modules/revalidate-queue/revalidate.service';

async function bootstrap() {
  // Production refuses to start with a bad configuration; development prints what is switched off
  checkEnvAtStartup();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // The reverse proxy (Caddy) passes the client IP in X-Forwarded-For: trust it only from the proxy's
  // addresses (TRUST_PROXY, loopback by default), so req.ip is the client (per-IP limits) and a direct
  // caller cannot spoof it. The value is checked at startup (trustProxyEnvIssues).
  app.set(
    'trust proxy',
    parseTrustProxy(process.env.TRUST_PROXY) ?? 'loopback',
  );

  // Why origin: true is acceptable and when to revisit it: docs/API.md, "CORS".
  // Bearer-token arxitektura: hech qaysi endpoint cookie ishlatmaydi
  // (grep -rn "res.cookie" src bo'sh natija beradi), shuning uchun
  // credentials:true kerak emas va faqat xavfni oshiradi — origin:true
  // bilan birga u istalgan saytga Authorization sarlavhali so'rovlarni
  // credentialed rejimda yuborish imkonini beradi.
  app.enableCors({
    origin: true,
  });

  configureStatic(app);

  // X-Request-Id, one error shape for both APIs (AppErrorFilter), the validation pipe
  configureErrorHandling(app);

  const reflector = app.get(Reflector);
  // The staff token first, then the route's access rule for the caller's role (deny by default), then the step-up of
  // critical actions (@StepUp); their audit and owner SMS follow a successful answer
  app.useGlobalGuards(
    new AccessTokenUserGuard(reflector),
    new StaffAccessGuard(reflector),
    new StepUpGuard(reflector, app.get(StepUpTokenService)),
  );
  // After a successful staff change the venue stream says what changed (org.changed): no screen polls
  app.useGlobalInterceptors(
    new StepUpAuditInterceptor(reflector, app.get(OwnerSecurityNotifier)),
    new LiveMutationInterceptor(
      reflector,
      app.get(LiveEventBus),
      app.get(RevalidateService, { strict: false }),
    ),
  );

  // The contract lives in the repository (docs/openapi.json); production serves /docs only on request
  if (swaggerEnabled()) setupSwagger(app);

  await app.listen(process.env.PORT || 4000);
}

function setupSwagger(app: NestExpressApplication) {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: function (
        a: { get(key: string): string },
        b: { get(key: string): string },
      ) {
        const order: Record<string, string> = {
          get: '0',
          post: '1',
          put: '2',
          patch: '3',
          delete: '4',
        };
        return order[a.get('method')].localeCompare(order[b.get('method')]);
      },
    },
  });
}
void bootstrap();
