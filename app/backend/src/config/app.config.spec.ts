import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(cfg.app.trustProxy).toBe(false);
    expect(cfg.cors.origins).toEqual([
      'http://localhost:5173',
      'http://localhost:1420',
      'http://tauri.localhost',
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
      ['TRUST_PROXY', 'true'],
      ['TRUST_PROXY', '0x1'],
      ['TRUST_PROXY', 'evil.com'],
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
        SERVER_CRYPTO_KEY: Buffer.alloc(32, 7).toString('base64'),
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

  test('TRUST_PROXY parses hops and subnets, rejects blind true', () => {
    expect(loadAppConfig(withKeys({ TRUST_PROXY: '1' })).app.trustProxy).toBe(
      1,
    );
    expect(
      loadAppConfig(withKeys({ TRUST_PROXY: '10.0.0.0/8' })).app.trustProxy,
    ).toBe('10.0.0.0/8');
    expect(
      loadAppConfig(withKeys({ TRUST_PROXY: 'false' })).app.trustProxy,
    ).toBe(false);
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

describe('ssh, network policy, crypto keys and sshOps', () => {
  test('defaults', () => {
    const cfg = loadAppConfig(withKeys());
    expect(cfg.ssh).toEqual({
      connectTimeoutMs: 10000,
      commandTimeoutMs: 15000,
      installTimeoutMs: 60000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22],
      allowLoopback: false,
    });
    expect(cfg.throttle.sshOps).toEqual({ limit: 6, ttlMs: 60000 });
    expect(cfg.throttle.dockerReads).toEqual({ limit: 60, ttlMs: 60000 });
  });

  test('loopback разрешён только явным флагом', () => {
    expect(loadAppConfig(withKeys()).ssh.allowLoopback).toBe(false);
    expect(
      loadAppConfig(withKeys({ SSH_ALLOW_LOOPBACK: 'true' })).ssh.allowLoopback,
    ).toBe(true);
    expect(() =>
      loadAppConfig(withKeys({ SSH_ALLOW_LOOPBACK: 'yes' })),
    ).toThrow(/SSH_ALLOW_LOOPBACK/);
    expect(() =>
      loadAppConfig(
        withKeys({
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://app.example.com',
          SERVER_CRYPTO_KEY: Buffer.alloc(32, 7).toString('base64'),
          SSH_ALLOW_LOOPBACK: 'true',
        }),
      ),
    ).toThrow(/production/);
  });

  test('allowedPorts принимает списки и диапазоны, отклоняет мусор', () => {
    expect(
      loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '22, 2200-2202' })).ssh
        .allowedPorts,
    ).toEqual([22, 2200, 2201, 2202]);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '0' }))).toThrow(
      /SSH_ALLOWED_PORTS/,
    );
    expect(() =>
      loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '70000' })),
    ).toThrow(/SSH_ALLOWED_PORTS/);
    expect(() =>
      loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '22-20' })),
    ).toThrow(/SSH_ALLOWED_PORTS/);
    expect(() =>
      loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '1-200' })),
    ).toThrow(/SSH_ALLOWED_PORTS/);
  });

  test('production без SERVER_CRYPTO_KEY падает; без ключа — эфемерный с kid k1', () => {
    expect(() =>
      loadAppConfig(
        withKeys({
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://app.example.com',
        }),
      ),
    ).toThrow(/SERVER_CRYPTO_KEY/);

    const dev = loadAppConfig(withKeys());
    expect(dev.crypto.ephemeralServerKey).toBe(true);
    expect(dev.crypto.activeKey.id).toBe('k1');
    expect(dev.crypto.activeKey.key.length).toBe(32);
    expect(dev.crypto.oldKeys.size).toBe(0);
  });

  test('SERVER_CRYPTO_KEY_FILE: загрузка из файла, конфликты и ошибки', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bios-crypto-'));
    const keyB64 = Buffer.alloc(32, 9).toString('base64');
    const keyFile = join(dir, 'server.key');
    writeFileSync(keyFile, `${keyB64}\n`);

    const cfg = loadAppConfig(withKeys({ SERVER_CRYPTO_KEY_FILE: keyFile }));
    expect(cfg.crypto.activeKey.key).toEqual(Buffer.alloc(32, 9));
    expect(cfg.crypto.ephemeralServerKey).toBe(false);

    // Оба источника сразу — ошибка, молчаливого приоритета нет.
    expect(() =>
      loadAppConfig(
        withKeys({
          SERVER_CRYPTO_KEY_FILE: keyFile,
          SERVER_CRYPTO_KEY: keyB64,
        }),
      ),
    ).toThrow(/mutually exclusive/);

    // Нет файла — ошибка чтения, а не тихий фолбэк.
    expect(() =>
      loadAppConfig(
        withKeys({ SERVER_CRYPTO_KEY_FILE: join(dir, 'nope.key') }),
      ),
    ).toThrow(/unreadable/);

    // Пустой файл = ключа нет: dev — эфемерный, prod — падение.
    const emptyFile = join(dir, 'empty.key');
    writeFileSync(emptyFile, '  \n');
    expect(
      loadAppConfig(withKeys({ SERVER_CRYPTO_KEY_FILE: emptyFile })).crypto
        .ephemeralServerKey,
    ).toBe(true);
    expect(() =>
      loadAppConfig(
        withKeys({
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://app.example.com',
          SERVER_CRYPTO_KEY_FILE: emptyFile,
        }),
      ),
    ).toThrow(/SERVER_CRYPTO_KEY/);
  });

  test('OLD_KEYS декодируются по kid, кривые записи падают', () => {
    const a = Buffer.alloc(32, 7).toString('base64');
    const b = Buffer.alloc(32, 8).toString('base64');
    const cfg = loadAppConfig(
      withKeys({
        SERVER_CRYPTO_KEY: a,
        SERVER_CRYPTO_KEY_ID: 'k2',
        SERVER_CRYPTO_OLD_KEYS: `k1:${b}`,
      }),
    );
    expect(cfg.crypto.activeKey.id).toBe('k2');
    expect(cfg.crypto.activeKey.key).toEqual(Buffer.alloc(32, 7));
    expect(cfg.crypto.oldKeys.get('k1')).toEqual(Buffer.alloc(32, 8));
    expect(cfg.crypto.ephemeralServerKey).toBe(false);

    expect(() =>
      loadAppConfig(
        withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_OLD_KEYS: 'k1:' + a }),
      ),
    ).toThrow(/already present/);
    expect(() =>
      loadAppConfig(withKeys({ SERVER_CRYPTO_KEY: 'c2hvcnQ=' })),
    ).toThrow(/SERVER_CRYPTO_KEY/);
    expect(() =>
      loadAppConfig(
        withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_OLD_KEYS: 'broken' }),
      ),
    ).toThrow(/SERVER_CRYPTO_OLD_KEYS/);
    expect(() =>
      loadAppConfig(
        withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_KEY_ID: 'KI' }),
      ),
    ).toThrow(/SERVER_CRYPTO_KEY_ID/);
  });

  test('ssh env overrides применяются, невалидные — throw с именем переменной', () => {
    const cfg = loadAppConfig(
      withKeys({
        SSH_CONNECT_TIMEOUT_MS: '2500',
        AGENT_VERSION: '1.2.3',
        THROTTLE_SSH_OPS_LIMIT: '2',
        THROTTLE_DOCKER_READS_LIMIT: '20',
      }),
    );
    expect(cfg.ssh.connectTimeoutMs).toBe(2500);
    expect(cfg.ssh.agentVersion).toBe('1.2.3');
    expect(cfg.throttle.sshOps.limit).toBe(2);
    expect(cfg.throttle.dockerReads.limit).toBe(20);
    expect(() => loadAppConfig(withKeys({ AGENT_VERSION: 'v1' }))).toThrow(
      /AGENT_VERSION/,
    );
    expect(() =>
      loadAppConfig(withKeys({ SSH_INSTALL_TIMEOUT_MS: '0' })),
    ).toThrow(/SSH_INSTALL_TIMEOUT_MS/);
    expect(() =>
      loadAppConfig(withKeys({ AGENT_HEARTBEAT_STALE_SEC: '5' })),
    ).toThrow(/AGENT_HEARTBEAT_STALE_SEC/);
  });

  test('docker limits: дефолты и перегрузка env', () => {
    expect(loadAppConfig(withKeys()).docker).toEqual({
      logsMaxBytes: 262144,
      statsTimeoutMs: 15000,
    });
    expect(
      loadAppConfig(
        withKeys({
          DOCKER_LOGS_MAX_BYTES: '4096',
          DOCKER_STATS_TIMEOUT_MS: '30000',
        }),
      ).docker,
    ).toEqual({ logsMaxBytes: 4096, statsTimeoutMs: 30000 });
  });

  test('docker limits: ноль, мусор и выход за диапазон — fail-fast', () => {
    expect(() =>
      loadAppConfig(withKeys({ DOCKER_LOGS_MAX_BYTES: '0' })),
    ).toThrow(/DOCKER_LOGS_MAX_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DOCKER_LOGS_MAX_BYTES: '16777216' })),
    ).toThrow(/DOCKER_LOGS_MAX_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DOCKER_STATS_TIMEOUT_MS: 'x' })),
    ).toThrow(/DOCKER_STATS_TIMEOUT_MS/);
    expect(() =>
      loadAppConfig(withKeys({ DOCKER_STATS_TIMEOUT_MS: '500' })),
    ).toThrow(/DOCKER_STATS_TIMEOUT_MS/);
  });
});
