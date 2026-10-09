import type { Response } from 'express';

export interface CookieFlags {
  cookieSecure: boolean;
  accessTtlSec: number;
  refreshTtlSec: number;
}

/** Единое правило Secure-флага (совпадает с AuthConfig.cookieSecure). */
export function isSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function buildCookieOptions(
  flags: Pick<CookieFlags, 'cookieSecure'>,
  maxAgeMs: number,
) {
  return {
    maxAge: maxAgeMs,
    httpOnly: true,
    secure: flags.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setPairCookies(
  res: Response,
  flags: CookieFlags,
  pair: { accessToken: string; refreshToken: string },
) {
  res.cookie(
    'refresh_token',
    pair.refreshToken,
    buildCookieOptions(flags, flags.refreshTtlSec * 1000),
  );
  res.cookie(
    'access_token',
    pair.accessToken,
    buildCookieOptions(flags, flags.accessTtlSec * 1000),
  );
}

export function clearPairCookies(
  res: Response,
  flags: Pick<CookieFlags, 'cookieSecure'>,
) {
  const opts = buildCookieOptions(flags, 0);
  res.clearCookie('access_token', opts);
  res.clearCookie('refresh_token', opts);
}
