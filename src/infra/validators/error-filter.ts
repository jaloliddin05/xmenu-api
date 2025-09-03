import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
class ErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    console.log(exception);
    console.log(host.getArgs()[0].route);

    response.status(status).json({
      status,
      timestamp: new Date().toISOString(),
      message: exception.message,
    });
  }
}

export default ErrorFilter;
