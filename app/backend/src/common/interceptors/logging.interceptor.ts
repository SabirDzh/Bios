import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

// Семплирование access-лога: каждый запрос через console.log — это
// синхронный syscall на горячем пути. Пишем каждый N-й успех (пульс
// «сервис жив») + всегда медленные запросы (>SLOW_MS — см. бюджет p95).
// Ошибки 5xx логирует AllExceptionsFilter; 4xx не логируем сознательно
// (шум от 429/401, секретов в URL после S3 всё равно нет).
const SAMPLE_EVERY = 100;
const SLOW_MS = 500;

let successCounter = 0;

/** Сброс счётчика — только для тестов. */
export function resetLoggingSampleForTests(): void {
  successCounter = 0;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const ms = Date.now() - start;
        successCounter += 1;
        if (ms >= SLOW_MS || successCounter % SAMPLE_EVERY === 0) {
          console.log(
            `${request.method} ${request.url} ${response.statusCode} +${ms}ms`,
          );
        }
      }),
    );
  }
}
