import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_CONFIG, JWT_ALGORITHM, type AuthConfig } from './auth.config';

export const TOKEN_TYPE_ACCESS = 'access' as const;
export const TOKEN_TYPE_REFRESH = 'refresh' as const;

export interface AccessClaims {
  sub: string;
  username: string;
  email: string;
  /** familyId сессии — для logout/отзыва. */
  sid: string;
  jti: string;
  token_type: typeof TOKEN_TYPE_ACCESS;
}

export interface RefreshClaims {
  sub: string;
  /** familyId сессии. */
  sid: string;
  jti: string;
  token_type: typeof TOKEN_TYPE_REFRESH;
}

/** sha256-hex refresh JWT для привязки записи сессии без хранения самого токена. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function assertStringClaim(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UnauthorizedException(`invalid token: missing claim "${name}"`);
  }
  return value;
}

@Injectable()
export class JwtTokenService {
  constructor(
    private jwtService: JwtService,
    @Inject(AUTH_CONFIG) private config: AuthConfig,
  ) {}

  signAccess(input: {
    userId: string;
    username: string;
    email: string;
    familyId: string;
    jti: string;
  }): string {
    return this.jwtService.sign(
      {
        username: input.username,
        email: input.email,
        sid: input.familyId,
        token_type: TOKEN_TYPE_ACCESS,
      },
      {
        algorithm: JWT_ALGORITHM,
        privateKey: this.config.privateKey,
        subject: input.userId,
        jwtid: input.jti,
        expiresIn: this.config.accessTtlSec,
        issuer: this.config.issuer,
        audience: this.config.audience,
      },
    );
  }

  signRefresh(input: {
    userId: string;
    familyId: string;
    jti: string;
  }): string {
    return this.jwtService.sign(
      {
        sid: input.familyId,
        token_type: TOKEN_TYPE_REFRESH,
      },
      {
        algorithm: JWT_ALGORITHM,
        privateKey: this.config.privateKey,
        subject: input.userId,
        jwtid: input.jti,
        expiresIn: this.config.refreshTtlSec,
        issuer: this.config.issuer,
        audience: this.config.audience,
      },
    );
  }

  /** Строгая проверка: алгоритм из allowlist сервера, подпись, exp, iss/aud. */
  private verifyStrict(token: string): Record<string, unknown> {
    try {
      return this.jwtService.verify(token, {
        algorithms: [JWT_ALGORITHM],
        publicKey: this.config.publicKey,
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockToleranceSec,
      });
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }

  verifyAccess(token: string): AccessClaims {
    const payload = this.verifyStrict(token);
    if (payload['token_type'] !== TOKEN_TYPE_ACCESS) {
      throw new UnauthorizedException('invalid token type');
    }
    return {
      sub: assertStringClaim(payload['sub'], 'sub'),
      username: assertStringClaim(payload['username'], 'username'),
      email: assertStringClaim(payload['email'], 'email'),
      sid: assertStringClaim(payload['sid'], 'sid'),
      jti: assertStringClaim(payload['jti'], 'jti'),
      token_type: TOKEN_TYPE_ACCESS,
    };
  }

  verifyRefresh(token: string): RefreshClaims {
    const payload = this.verifyStrict(token);
    if (payload['token_type'] !== TOKEN_TYPE_REFRESH) {
      throw new UnauthorizedException('invalid token type');
    }
    return {
      sub: assertStringClaim(payload['sub'], 'sub'),
      sid: assertStringClaim(payload['sid'], 'sid'),
      jti: assertStringClaim(payload['jti'], 'jti'),
      token_type: TOKEN_TYPE_REFRESH,
    };
  }
}
