import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../../common/types/user-payload.type';
import { AUTH_CONFIG, type AuthConfig } from '../auth.config';
import { TOKEN_TYPE_ACCESS } from '../jwt-token.service';
import { ACCESS_COOKIE_NAME } from '../auth-cookies';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(AUTH_CONFIG) config: AuthConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null => {
          const cookies = req?.cookies as
            Record<string, string | undefined> | undefined;
          return cookies?.[ACCESS_COOKIE_NAME] ?? null;
        },
      ]),
      ignoreExpiration: false,
      algorithms: [config.algorithm],
      secretOrKey: config.publicKey,
      issuer: config.issuer,
      audience: config.audience,
    });
  }

  validate(payload: Record<string, unknown>): JwtUserPayload {
    // Refresh Token (и любой другой тип) как Access не принимается,
    // даже если подпись корректна.
    if (payload['token_type'] !== TOKEN_TYPE_ACCESS) {
      throw new UnauthorizedException('invalid token type');
    }
    const userId = payload['sub'];
    const sid = payload['sid'];
    const username = payload['username'];
    const email = payload['email'];
    if (
      typeof userId !== 'string' ||
      !userId ||
      typeof sid !== 'string' ||
      !sid ||
      typeof username !== 'string' ||
      typeof email !== 'string'
    ) {
      throw new UnauthorizedException('invalid token claims');
    }
    return { userId, username, email, sid };
  }
}
