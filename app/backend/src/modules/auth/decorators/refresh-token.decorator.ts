import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { REFRESH_COOKIE_NAME } from '../auth-cookies';

/** Извлекает refresh-куку; пустое/нестроковое значение — 401. */
export const RefreshTokenCookie = createParamDecorator<unknown, string>(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[REFRESH_COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('missing refresh token');
    }
    return token;
  },
);
