import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/** Извлекает refresh_token из cookies; пустое/нестроковое значение — 401. */
export const RefreshTokenCookie = createParamDecorator<unknown, string>(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.refresh_token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('missing refresh token');
    }
    return token;
  },
);
