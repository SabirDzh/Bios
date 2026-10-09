import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

function isMessageBody(value: unknown): value is { message: unknown } {
  return typeof value === 'object' && value !== null && 'message' in value;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      // Внутренние ошибки логируем, наружу — только generic message.
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    let message: unknown;
    if (typeof body === 'string') {
      message = body;
    } else if (isMessageBody(body)) {
      message = body.message;
    } else {
      message = status >= 500 ? 'Internal server error' : 'Unexpected error';
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
