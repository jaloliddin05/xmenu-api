import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  ErrorResponse,
  FieldErrorDto,
} from './infra/errors/error-response.dto';
import { collectRoutes, openApiPath } from './modules/auth/access/route-rules';
import { Env, isProduction } from './config/env/env-issues';

/** Whether /docs is served: always outside production, in production only with SWAGGER_ENABLED=true. */
export function swaggerEnabled(env: Env = process.env): boolean {
  return !isProduction(env) || env.SWAGGER_ENABLED === 'true';
}

const ERROR_RESPONSE = {
  description: 'Error: one shape for every endpoint (docs/ERRORS.md)',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
};

/** Every operation documents the common error shape as its `default` response. */
function addDefaultErrorResponse(document: OpenAPIObject): OpenAPIObject {
  for (const path of Object.values(document.paths)) {
    for (const method of ['get', 'put', 'post', 'delete', 'patch'] as const) {
      const op = path[method];
      if (op) op.responses = { ...op.responses, default: ERROR_RESPONSE };
    }
  }
  return document;
}

/**
 * `x-permission` on every staff operation: the permission its StaffAccess rule needs
 * (docs/API.md, "Сотрудники и права"); `platform-admin` for platform endpoints.
 */
function addPermissions(
  document: OpenAPIObject,
  app: INestApplication,
): OpenAPIObject {
  for (const route of collectRoutes(app)) {
    if (route.rule === 'public' || route.rule === null) continue;
    const op = document.paths[openApiPath(route.path)]?.[
      route.method.toLowerCase() as 'get'
    ] as Record<string, unknown> | undefined;
    if (op) op['x-permission'] = route.rule.permission;
  }
  return document;
}

/** One source for the served /docs and the generated docs/openapi.json (npm run openapi). */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
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

  return addPermissions(
    addDefaultErrorResponse(
      SwaggerModule.createDocument(app, config, {
        extraModels: [ErrorResponse, FieldErrorDto],
      }),
    ),
    app,
  );
}
