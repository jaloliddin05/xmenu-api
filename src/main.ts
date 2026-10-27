import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ErrorFilter } from './infra/validators';
import { AccessTokenUserGuard } from './modules/auth/passport-strategies/access-token-user/access-token-user.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Bearer-token arxitektura: hech qaysi endpoint cookie ishlatmaydi
  // (grep -rn "res.cookie" src bo'sh natija beradi), shuning uchun
  // credentials:true kerak emas va faqat xavfni oshiradi — origin:true
  // bilan birga u istalgan saytga Authorization sarlavhali so'rovlarni
  // credentialed rejimda yuborish imkonini beradi.
  app.enableCors({
    origin: true,
  });

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

  const config = new DocumentBuilder()
    .setTitle('Xmenu')
    .setDescription('Xmenu API description')
    .setVersion('0.2')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addSecurityRequirements('access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
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
