import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  ErrorResponse,
  FieldErrorDto,
} from './infra/errors/error-response.dto';

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

  return addDefaultErrorResponse(
    SwaggerModule.createDocument(app, config, {
      extraModels: [ErrorResponse, FieldErrorDto],
    }),
  );
}
