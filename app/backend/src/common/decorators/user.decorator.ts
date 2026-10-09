import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUserPayload } from '../types/user-payload.type';

export const User = createParamDecorator<unknown, JwtUserPayload>(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: JwtUserPayload }>();
    return request.user;
  },
);
