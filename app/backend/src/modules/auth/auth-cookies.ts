import type { Response } from 'express';
import type { AppConfig } from '../../config/app.config';

/** Имена и path кук меняться между деплоями не должны — константы, один источник. */
export const ACCESS_COOKIE_NAME = 'access_token';
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const COOKIE_PATH = '/';

export interface CookieFlags {
  cookieSecure: boolean;
  accessTtlSec: number;
  refreshTtlSec: number;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
}

/** Единое правило Secure-флага (совпадает с AppConfig.cookies.secure). */
export function isSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function buildCookieOptions(
  flags: Pick<CookieFlags, 'cookieSecure' | 'sameSite' | 'path'>,
  maxAgeMs: number,
) {
  return {
    maxAge: maxAgeMs,
    httpOnly: true,
    secure: flags.cookieSecure,
    sameSite: flags.sameSite,
    path: flags.path,
  };
}

export function setPairCookies(
  res: Response,
  flags: CookieFlags,
  pair: { accessToken: string; refreshToken: string },
) {
  res.cookie(
    REFRESH_COOKIE_NAME,
    pair.refreshToken,
    buildCookieOptions(flags, flags.refreshTtlSec * 1000),
  );
  res.cookie(
    ACCESS_COOKIE_NAME,
    pair.accessToken,
    buildCookieOptions(flags, flags.accessTtlSec * 1000),
  );
}

export function clearPairCookies(
  res: Response,
  flags: Pick<CookieFlags, 'cookieSecure' | 'sameSite' | 'path'>,
) {
  const opts = buildCookieOptions(flags, 0);
  res.clearCookie(ACCESS_COOKIE_NAME, opts);
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}

/** Собирает флаги кук из единого AppConfig. */
export function cookieFlagsFrom(app: AppConfig): CookieFlags {
  return {
    cookieSecure: app.cookies.secure,
    accessTtlSec: app.jwt.accessTtlSec,
    refreshTtlSec: app.jwt.refreshTtlSec,
    sameSite: app.cookies.sameSite,
    path: app.cookies.path,
  };
}
