import { generateKeyPairSync } from 'node:crypto';
import { loadAppConfig } from './app.config';
import { loadAuthConfig } from '../modules/auth/auth.config';

function withKeys(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    NODE_ENV: 'test',
    ...env,
    JWT_PRIVATE_KEY: pair.privateKey,
    JWT_PUBLIC_KEY: pair.publicKey,
  };
}

describe('loadAppConfig defaults (must match current hardcoded behavior)', () => {
  test('defaults equal live values', () => {
    const cfg = loadAppConfig(withKeys());
    expect(cfg.app.port).toBe(3000);
    expect(cfg.app.isProduction).toBe(false);
    expect(cfg.cors.origins).toEqual([
      'http://localhost:5173',
      'http://localhost:1420',
    ]);
    expect(cfg.throttle.global).toEqual({ limit: 120, ttlMs: 60000 });
    expect(cfg.throttle.authStrict).toEqual({ limit: 10, ttlMs: 60000 });
    expect(cfg.throttle.recovery).toEqual({ limit: 5, ttlMs: 60000 });
    expect(cfg.throttle.invite).toEqual({ limit: 30, ttlMs: 60000 });
    expect(cfg.jwt.accessTtlSec).toBe(600);
    expect(cfg.jwt.refreshTtlSec).toBe(604800);
    expect(cfg.jwt.issuer).toBe('bios');
    expect(cfg.jwt.audience).toBe('bios-api');
    expect(cfg.jwt.clockToleranceSec).toBe(5);
    expect(cfg.cookies.accessName).toBe('access_token');
    expect(cfg.cookies.refreshName).toBe('refresh_token');
    expect(cfg.cookies.path).toBe('/');
    expect(cfg.cookies.sameSite).toBe('lax');
    expect(cfg.cookies.secure).toBe(false);
    expect(cfg.cookies.httpOnly).toBe(true);
    expect(cfg.email.verifyMx).toBe(true);
    expect(cfg.email.mxTimeoutMs).toBe(3000);
    expect(cfg.email.extraBlockedDomains).toEqual([]);
    expect(cfg.invitations.ttlSec).toBe(604800);
    expect(cfg.tokens.confirmTtlSec).toBe(86400);
    expect(cfg.tokens.recoveryTtlSec).toBe(3600);
    expect(cfg.maintenance.cron).toBe('0 3 * * *');
    expect(cfg.maintenance.timeZone).toBe('UTC');
    expect(cfg.maintenance.staleSessionDays).toBe(30);
  });

  test('invalid values throw with the variable name', () => {
    const bad: Array<[string, string]> = [
      ['PORT', 'abc'],
      ['PORT', '0'],
      ['PORT', '99999'],
      ['THROTTLE_GLOBAL_LIMIT', '0'],
      ['THROTTLE_GLOBAL_TTL_MS', '-5'],
      ['JWT_ACCESS_TTL_SEC', '0'],
      ['JWT_ACCESS_TTL_SEC', '1.5'],
      ['JWT_REFRESH_TTL_SEC', '99999999'],
      ['INVITATION_TTL_SEC', '0'],
      ['TOKEN_CONFIRM_TTL_SEC', '0'],
      ['TOKEN_RECOVERY_TTL_SEC', '99999999'],
      ['EMAIL_MX_TIMEOUT_MS', '0'],
      ['MAINTENANCE_CRON', 'nonsense'],
      ['MAINTENANCE_TIMEZONE', 'Mars/Olympus'],
      ['MAINTENANCE_STALE_DAYS', '0'],
      ['COOKIE_SAMESITE', 'banana'],
    ];
    for (const [name, value] of bad) {
      expect(() => loadAppConfig(withKeys({ [name]: value }))).toThrow(name);
    }
  });

  test('SameSite=none without Secure fails; production CORS required', () => {
    expect(() => loadAppConfig(withKeys({ COOKIE_SAMESITE: 'none' }))).toThrow(
      'COOKIE_SAMESITE',
    );
    expect(() => loadAppConfig(withKeys({ NODE_ENV: 'production' }))).toThrow(
      'CORS_ORIGINS',
    );
    const prod = loadAppConfig(
      withKeys({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
      }),
    );
    expect(prod.app.isProduction).toBe(true);
    expect(prod.cookies.secure).toBe(true);
    expect(prod.cors.origins).toEqual(['https://app.example.com']);
    expect(prod.jwt.ephemeralKeys).toBe(false);
  });

  test('app.jwt matches direct loadAuthConfig on the same env', () => {
    const env = withKeys({ JWT_ACCESS_TTL_SEC: '300' });
    const app = loadAppConfig(env);
    const direct = loadAuthConfig(env);
    expect(app.jwt.publicKeyFingerprint).toBe(direct.publicKeyFingerprint);
    expect(app.jwt.accessTtlSec).toBe(direct.accessTtlSec);
    expect(app.jwt.refreshTtlSec).toBe(direct.refreshTtlSec);
    expect(app.jwt.issuer).toBe(direct.issuer);
    expect(app.jwt.audience).toBe(direct.audience);
    expect(app.jwt.clockToleranceSec).toBe(direct.clockToleranceSec);
  });

  test('env overrides apply', () => {
    const cfg = loadAppConfig(
      withKeys({
        PORT: '4000',
        THROTTLE_AUTH_STRICT_LIMIT: '3',
        INVITATION_TTL_SEC: '3600',
        EMAIL_EXTRA_BLOCKED_DOMAINS: 'Spam.IO, evil.example ',
        MAINTENANCE_TIMEZONE: 'Europe/Moscow',
      }),
    );
    expect(cfg.app.port).toBe(4000);
    expect(cfg.throttle.authStrict).toEqual({ limit: 3, ttlMs: 60000 });
    expect(cfg.invitations.ttlSec).toBe(3600);
    expect(cfg.email.extraBlockedDomains).toEqual(['spam.io', 'evil.example']);
    expect(cfg.maintenance.timeZone).toBe('Europe/Moscow');
  });
});
