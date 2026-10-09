import { CronJob } from 'cron';
import { AUTH_CONFIG } from '../modules/auth/auth.config';
import type { AuthConfig } from '../modules/auth/auth.config';
import { loadAuthConfig } from '../modules/auth/auth.config';

export { AUTH_CONFIG };
export type { AuthConfig };

export interface ThrottleProfileCfg {
  limit: number;
  ttlMs: number;
}

export type ThrottleProfileName = 'authStrict' | 'recovery' | 'invite';

export interface AppConfig {
  app: { port: number; isProduction: boolean };
  cors: { origins: string[] };
  throttle: {
    global: ThrottleProfileCfg;
    authStrict: ThrottleProfileCfg;
    recovery: ThrottleProfileCfg;
    invite: ThrottleProfileCfg;
  };
  jwt: AuthConfig;
  cookies: {
    accessName: string;
    refreshName: string;
    path: string;
    sameSite: 'lax' | 'strict' | 'none';
    secure: boolean;
    httpOnly: true;
  };
  email: {
    verifyMx: boolean;
    mxTimeoutMs: number;
    extraBlockedDomains: string[];
  };
  invitations: { ttlSec: number };
  tokens: { confirmTtlSec: number; recoveryTtlSec: number };
  maintenance: { cron: string; timeZone: string; staleSessionDays: number };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function positiveInt(
  raw: string | undefined,
  name: string,
  opts: { min?: number; max?: number; fallback?: number },
): number {
  if (raw === undefined || raw === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new Error(`Missing required ${name}`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < (opts.min ?? 1)) {
    throw new Error(
      `Invalid ${name}="${raw}": expected integer >= ${opts.min ?? 1}`,
    );
  }
  if (opts.max !== undefined && parsed > opts.max) {
    throw new Error(
      `Invalid ${name}="${raw}": expected integer <= ${opts.max}`,
    );
  }
  return parsed;
}

function parseOrigins(
  raw: string | undefined,
  isProduction: boolean,
): string[] {
  if (raw === undefined || raw === '') {
    if (isProduction) {
      throw new Error('Missing required CORS_ORIGINS in production');
    }
    return ['http://localhost:5173', 'http://localhost:1420'];
  }
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error();
    } catch {
      throw new Error(
        `Invalid CORS_ORIGINS entry "${origin}": expected http(s) URL`,
      );
    }
  }
  if (origins.length === 0 && isProduction) {
    throw new Error('Missing required CORS_ORIGINS in production');
  }
  return origins;
}

function parseDomainList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseThrottle(
  env: NodeJS.ProcessEnv,
  prefix: string,
  fallback: ThrottleProfileCfg,
): ThrottleProfileCfg {
  return {
    limit: positiveInt(env[`${prefix}_LIMIT`], `${prefix}_LIMIT`, {
      min: 1,
      fallback: fallback.limit,
    }),
    ttlMs: positiveInt(env[`${prefix}_TTL_MS`], `${prefix}_TTL_MS`, {
      min: 1,
      fallback: fallback.ttlMs,
    }),
  };
}

function parseSameSite(raw: string | undefined): 'lax' | 'strict' | 'none' {
  const value = (raw ?? 'lax').toLowerCase();
  if (value !== 'lax' && value !== 'strict' && value !== 'none') {
    throw new Error(
      `Invalid COOKIE_SAMESITE="${raw}": expected lax, strict or none`,
    );
  }
  return value;
}

function parseSecure(raw: string | undefined, isProduction: boolean): boolean {
  if (raw === undefined || raw === '') return isProduction;
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`Invalid COOKIE_SECURE="${raw}": expected true or false`);
  }
  return raw === 'true';
}

function parseCron(raw: string | undefined): string {
  const cron = raw ?? '0 3 * * *';
  try {
    new CronJob(cron, () => undefined);
  } catch {
    throw new Error(`Invalid MAINTENANCE_CRON="${cron}"`);
  }
  return cron;
}

function parseTimeZone(raw: string | undefined): string {
  const timeZone = raw ?? 'UTC';
  // 'UTC' — канонический алиас, валиден всегда, но в supportedValuesOf его может не быть.
  if (
    timeZone !== 'UTC' &&
    !Intl.supportedValuesOf('timeZone').includes(timeZone)
  ) {
    throw new Error(`Invalid MAINTENANCE_TIMEZONE="${timeZone}"`);
  }
  return timeZone;
}

/**
 * Единственная точка чтения и проверки конфигурации.
 * Все модули получают значения из результата, напрямую process.env не читают.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const port = positiveInt(env.PORT, 'PORT', {
    min: 1,
    max: 65535,
    fallback: 3000,
  });

  const jwt = loadAuthConfig(env);
  // Разумные верхние границы TTL (fail-fast таблица): access — сутки, refresh — 30 дней.
  if (jwt.accessTtlSec > 86400) {
    throw new Error(
      `Invalid JWT_ACCESS_TTL_SEC="${env.JWT_ACCESS_TTL_SEC}": expected integer <= 86400`,
    );
  }
  if (jwt.refreshTtlSec > 2592000) {
    throw new Error(
      `Invalid JWT_REFRESH_TTL_SEC="${env.JWT_REFRESH_TTL_SEC}": expected integer <= 2592000`,
    );
  }

  const sameSite = parseSameSite(env.COOKIE_SAMESITE);
  const secure = parseSecure(env.COOKIE_SECURE, isProduction);
  if (sameSite === 'none' && !secure) {
    throw new Error('Invalid COOKIE_SAMESITE="none": requires Secure cookies');
  }

  return {
    app: { port, isProduction },
    cors: { origins: parseOrigins(env.CORS_ORIGINS, isProduction) },
    throttle: {
      global: parseThrottle(env, 'THROTTLE_GLOBAL', {
        limit: 120,
        ttlMs: 60000,
      }),
      authStrict: parseThrottle(env, 'THROTTLE_AUTH_STRICT', {
        limit: 10,
        ttlMs: 60000,
      }),
      recovery: parseThrottle(env, 'THROTTLE_RECOVERY', {
        limit: 5,
        ttlMs: 60000,
      }),
      invite: parseThrottle(env, 'THROTTLE_INVITE', {
        limit: 30,
        ttlMs: 60000,
      }),
    },
    jwt,
    cookies: {
      accessName: env.COOKIE_ACCESS_NAME || 'access_token',
      refreshName: env.COOKIE_REFRESH_NAME || 'refresh_token',
      path: env.COOKIE_PATH || '/',
      sameSite,
      secure,
      httpOnly: true,
    },
    email: {
      verifyMx: env.EMAIL_VERIFY_MX !== 'false',
      mxTimeoutMs: positiveInt(env.EMAIL_MX_TIMEOUT_MS, 'EMAIL_MX_TIMEOUT_MS', {
        min: 1,
        fallback: 3000,
      }),
      extraBlockedDomains: parseDomainList(env.EMAIL_EXTRA_BLOCKED_DOMAINS),
    },
    invitations: {
      ttlSec: positiveInt(env.INVITATION_TTL_SEC, 'INVITATION_TTL_SEC', {
        min: 1,
        max: 2592000,
        fallback: 604800,
      }),
    },
    tokens: {
      confirmTtlSec: positiveInt(
        env.TOKEN_CONFIRM_TTL_SEC,
        'TOKEN_CONFIRM_TTL_SEC',
        {
          min: 1,
          max: 604800,
          fallback: 86400,
        },
      ),
      recoveryTtlSec: positiveInt(
        env.TOKEN_RECOVERY_TTL_SEC,
        'TOKEN_RECOVERY_TTL_SEC',
        {
          min: 1,
          max: 86400,
          fallback: 3600,
        },
      ),
    },
    maintenance: {
      cron: parseCron(env.MAINTENANCE_CRON),
      timeZone: parseTimeZone(env.MAINTENANCE_TIMEZONE),
      staleSessionDays: positiveInt(
        env.MAINTENANCE_STALE_DAYS,
        'MAINTENANCE_STALE_DAYS',
        {
          min: 1,
          fallback: 30,
        },
      ),
    },
  };
}
