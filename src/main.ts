import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument } from './swagger';
import { AppModule } from './app.module';
import { configureStatic } from './infra/http/static-assets';
import { ErrorFilter } from './infra/validators';
import { AccessTokenUserGuard } from './modules/auth/passport-strategies/access-token-user/access-token-user.guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // nginx on the same host proxies every request: trust X-Forwarded-For from loopback only, so
  // req.ip is the client (per-IP auth limits) and a direct caller cannot spoof it.
  app.set('trust proxy', 'loopback');

  // Bearer-token arxitektura: hech qaysi endpoint cookie ishlatmaydi
  // (grep -rn "res.cookie" src bo'sh natija beradi), shuning uchun
  // credentials:true kerak emas va faqat xavfni oshiradi — origin:true
  // bilan birga u istalgan saytga Authorization sarlavhali so'rovlarni
  // credentialed rejimda yuborish imkonini beradi.
  app.enableCors({
    origin: true,
  });

  configureStatic(app);

  app.useGlobalFilters(new ErrorFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new AccessTokenUserGuard(reflector));

  const document = createOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: function (a, b) {
        const order = {
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

  await app.listen(process.env.PORT || 4000);
}
bootstrap();
