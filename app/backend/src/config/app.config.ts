import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

export type ThrottleProfileName =
  'authStrict' | 'recovery' | 'invite' | 'sshOps' | 'dockerReads';

export interface SshCfg {
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  installTimeoutMs: number;
  /** Версия агента, которую панель устанавливает на хост. */
  agentVersion: string;
  /** Порог протухания heartbeat: старше — агент считается STALE. */
  heartbeatStaleSec: number;
  /** Единственные порты, к которым панели разрешено подключаться. */
  allowedPorts: number[];
  /** Разрешить loopback: только локальная разработка и дымовой тест. */
  allowLoopback: boolean;
}

export interface DockerCfg {
  /** Потолок байт логов на один ответ панели: считаем в UTF-8, не в символах. */
  logsMaxBytes: number;
  /** stats({stream:false}) внутри одного вызова делает две выборки (~1 с). */
  statsTimeoutMs: number;
}

export interface DeployCfg {
  /** Корень, под которым панель держит clone и логи на ХОСТЕ. Абсолютный путь. */
  rootDir: string;
  /** Дедлайн ОДНОГО шага: сборка образа — минуты, preflight — десятки мс. */
  stepTimeoutMs: number;
  /** Сколько байт журнала шага приезжает в панель (полный лог остаётся на хосте). */
  logTailBytes: number;
  /** Сколько байт вывода шага оставляем на хосте. */
  hostLogBytes: number;
  /** Сколько деплоев исполнитель ведёт одновременно. */
  maxParallel: number;
}

export interface CryptoCfg {
  activeKey: { id: string; key: Buffer };
  /** Decrypt-only: старые kid переживают ротацию, новым ключом они не шифруются. */
  oldKeys: Map<string, Buffer>;
  /** true — ключ сгенерирован эфемерно (только non-production). */
  ephemeralServerKey: boolean;
}

export interface AppConfig {
  app: {
    port: number;
    isProduction: boolean;
    trustProxy: false | number | string;
  };
  cors: { origins: string[] };
  throttle: {
    global: ThrottleProfileCfg;
    authStrict: ThrottleProfileCfg;
    recovery: ThrottleProfileCfg;
    invite: ThrottleProfileCfg;
    sshOps: ThrottleProfileCfg;
    dockerReads: ThrottleProfileCfg;
  };
  ssh: SshCfg;
  docker: DockerCfg;
  deploy: DeployCfg;
  crypto: CryptoCfg;
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

/**
 * Доверие прокси для Express (`trust proxy`): влияет на req.ip и throttling.
 * `false` (дефолт) — напрямую, без прокси. Число — количество хопов,
 * строка — IP/подсеть доверенного прокси. Голое `true` запрещено сознательно:
 * слепое доверие X-Forwarded-For из интернета даёт IP-spoofing.
 */
function parseTrustProxy(raw: string | undefined): false | number | string {
  if (raw === undefined || raw === '') return false;
  const value = raw.trim().toLowerCase();
  if (value === 'false' || value === '0') return false;
  if (value === 'true') {
    throw new Error(
      'Invalid TRUST_PROXY="true": use hop count (e.g. "1") or proxy IP/subnet instead of blind trust',
    );
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 10) {
      throw new Error(`Invalid TRUST_PROXY="${raw}": hop count 1-10`);
    }
    return hops;
  }
  if (/^[0-9a-fA-F:.,/ ]+$/.test(value) && value.length <= 256) {
    return raw.trim();
  }
  throw new Error(
    `Invalid TRUST_PROXY="${raw}": expected false, hop count or IP/subnet`,
  );
}

function parseOrigins(
  raw: string | undefined,
  isProduction: boolean,
): string[] {
  if (raw === undefined || raw === '') {
    if (isProduction) {
      throw new Error('Missing required CORS_ORIGINS in production');
    }
    return [
      'http://localhost:5173',
      'http://localhost:1420',
      'http://tauri.localhost',
    ];
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

const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;

function decodeKey(raw: string, name: string): Buffer {
  if (!/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(raw)) {
    throw new Error(`Invalid ${name}: expected base64 of 32 bytes`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`Invalid ${name}: expected 32 bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Активный ключ: либо `SERVER_CRYPTO_KEY`, либо файл `SERVER_CRYPTO_KEY_FILE
 * (Docker secrets и т.п. — ключ не светится в env/inspect). Оба сразу — ошибка.
 */
function readActiveKey(env: NodeJS.ProcessEnv): string | undefined {
  const fromEnv = env.SERVER_CRYPTO_KEY?.trim() || undefined;
  const filePath = env.SERVER_CRYPTO_KEY_FILE?.trim() || undefined;
  if (fromEnv !== undefined && filePath !== undefined) {
    throw new Error(
      'SERVER_CRYPTO_KEY and SERVER_CRYPTO_KEY_FILE are mutually exclusive',
    );
  }
  if (filePath !== undefined) {
    try {
      const content = readFileSync(filePath, 'utf8').trim();
      return content === '' ? undefined : content;
    } catch (err) {
      throw new Error(
        `SERVER_CRYPTO_KEY_FILE unreadable: ${(err as Error).message}`,
      );
    }
  }
  return fromEnv;
}

/**
 * Ключ шифрования SSH-креденшелов серверов. Ротация: старый ключ остаётся в
 * SERVER_CRYPTO_OLD_KEYS (decrypt-only), активный перемалывает cipher при чтении.
 */
function parseCrypto(env: NodeJS.ProcessEnv, isProduction: boolean): CryptoCfg {
  const activeId = env.SERVER_CRYPTO_KEY_ID?.trim() || 'k1';
  if (!KEY_ID_RE.test(activeId)) {
    throw new Error(
      `Invalid SERVER_CRYPTO_KEY_ID="${env.SERVER_CRYPTO_KEY_ID}": expected short slug`,
    );
  }

  const oldKeys = new Map<string, Buffer>();
  for (const entry of (env.SERVER_CRYPTO_OLD_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const sep = entry.indexOf(':');
    const kid = sep === -1 ? '' : entry.slice(0, sep);
    if (!KEY_ID_RE.test(kid)) {
      throw new Error(
        `Invalid SERVER_CRYPTO_OLD_KEYS entry "${entry}": expected kid:base64`,
      );
    }
    oldKeys.set(
      kid,
      decodeKey(entry.slice(sep + 1), `SERVER_CRYPTO_OLD_KEYS[${kid}]`),
    );
  }

  const rawActive = readActiveKey(env);
  if (rawActive === undefined) {
    if (isProduction) {
      throw new Error(
        'Missing required SERVER_CRYPTO_KEY or SERVER_CRYPTO_KEY_FILE in production',
      );
    }
    if (oldKeys.size > 0) {
      throw new Error(
        'Invalid SERVER_CRYPTO_OLD_KEYS: SERVER_CRYPTO_KEY is required to encrypt new credentials',
      );
    }
    return {
      activeKey: { id: activeId, key: randomBytes(32) },
      oldKeys,
      ephemeralServerKey: true,
    };
  }
  if (oldKeys.has(activeId)) {
    throw new Error(
      `SERVER_CRYPTO_KEY_ID "${activeId}" is already present in SERVER_CRYPTO_OLD_KEYS`,
    );
  }
  return {
    activeKey: { id: activeId, key: decodeKey(rawActive, 'SERVER_CRYPTO_KEY') },
    oldKeys,
    ephemeralServerKey: false,
  };
}

/** Allowlist портов: одиночные значения и диапазоны через запятую («22, 2200-2202»). */
function parsePorts(raw: string | undefined): number[] {
  const value = raw?.trim();
  if (value === undefined || value === '') return [22];
  const ports = new Set<number>();
  for (const token of value.split(',').map((s) => s.trim())) {
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > 65535 || to < from || to - from > 63) {
        throw new Error(
          `Invalid SSH_ALLOWED_PORTS range "${token}": expected 1-65535, span <= 64`,
        );
      }
      for (let port = from; port <= to; port += 1) ports.add(port);
      continue;
    }
    const single = Number(token);
    if (!/^\d{1,5}$/.test(token) || single < 1 || single > 65535) {
      throw new Error(
        `Invalid SSH_ALLOWED_PORTS entry "${token}": expected port 1-65535`,
      );
    }
    ports.add(single);
  }
  if (ports.size === 0) {
    throw new Error('Invalid SSH_ALLOWED_PORTS: empty allowlist');
  }
  return [...ports].sort((a, b) => a - b);
}

const ABSOLUTE_DIR_RE = /^\/[A-Za-z0-9._/-]{0,199}$/;

/**
 * Корень на хосте попадает в shell-строку, поэтому whitelist без `..`, пробелов,
 * кавычек и `$`: путь из env — не пользовательский ввод, но инвариант
 * «в shell уходит только проверенное» не должен зависеть от этого.
 */
function parseAbsoluteDir(raw: string | undefined): string {
  const value = (raw ?? '/opt/bios-deploy').trim();
  if (!ABSOLUTE_DIR_RE.test(value) || value.includes('..')) {
    throw new Error(
      `Invalid DEPLOY_ROOT_DIR="${raw}": expected an absolute path without ".." or shell metacharacters`,
    );
  }
  return value;
}

function parseBoolFlag(
  raw: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Invalid ${name}="${raw}": expected true or false`);
  }
  return value === 'true';
}

function parseAgentVersion(raw: string | undefined): string {
  const value = raw ?? '0.1.0';
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Invalid AGENT_VERSION="${raw}": expected x.y.z`);
  }
  return value;
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

  const allowLoopback = parseBoolFlag(
    env.SSH_ALLOW_LOOPBACK,
    'SSH_ALLOW_LOOPBACK',
    false,
  );
  if (allowLoopback && isProduction) {
    throw new Error(
      'Invalid SSH_ALLOW_LOOPBACK="true": loopback targets are not allowed in production',
    );
  }

  const ssh: SshCfg = {
    connectTimeoutMs: positiveInt(
      env.SSH_CONNECT_TIMEOUT_MS,
      'SSH_CONNECT_TIMEOUT_MS',
      { min: 1, max: 60000, fallback: 10000 },
    ),
    commandTimeoutMs: positiveInt(
      env.SSH_COMMAND_TIMEOUT_MS,
      'SSH_COMMAND_TIMEOUT_MS',
      { min: 1, max: 120000, fallback: 15000 },
    ),
    installTimeoutMs: positiveInt(
      env.SSH_INSTALL_TIMEOUT_MS,
      'SSH_INSTALL_TIMEOUT_MS',
      { min: 1, max: 300000, fallback: 60000 },
    ),
    agentVersion: parseAgentVersion(env.AGENT_VERSION),
    heartbeatStaleSec: positiveInt(
      env.AGENT_HEARTBEAT_STALE_SEC,
      'AGENT_HEARTBEAT_STALE_SEC',
      { min: 10, max: 3600, fallback: 60 },
    ),
    allowedPorts: parsePorts(env.SSH_ALLOWED_PORTS),
    allowLoopback,
  };

  const docker: DockerCfg = {
    logsMaxBytes: positiveInt(
      env.DOCKER_LOGS_MAX_BYTES,
      'DOCKER_LOGS_MAX_BYTES',
      { min: 1024, max: 8388608, fallback: 262144 },
    ),
    statsTimeoutMs: positiveInt(
      env.DOCKER_STATS_TIMEOUT_MS,
      'DOCKER_STATS_TIMEOUT_MS',
      { min: 1000, max: 120000, fallback: 15000 },
    ),
  };

  const deploy: DeployCfg = {
    rootDir: parseAbsoluteDir(env.DEPLOY_ROOT_DIR),
    stepTimeoutMs: positiveInt(
      env.DEPLOY_STEP_TIMEOUT_MS,
      'DEPLOY_STEP_TIMEOUT_MS',
      { min: 1000, max: 900000, fallback: 300000 },
    ),
    logTailBytes: positiveInt(
      env.DEPLOY_LOG_TAIL_BYTES,
      'DEPLOY_LOG_TAIL_BYTES',
      { min: 1024, max: 262144, fallback: 32768 },
    ),
    hostLogBytes: positiveInt(
      env.DEPLOY_HOST_LOG_BYTES,
      'DEPLOY_HOST_LOG_BYTES',
      { min: 65536, max: 8388608, fallback: 1048576 },
    ),
    maxParallel: positiveInt(env.DEPLOY_MAX_PARALLEL, 'DEPLOY_MAX_PARALLEL', {
      min: 1,
      max: 8,
      fallback: 2,
    }),
  };
  if (deploy.logTailBytes > deploy.hostLogBytes) {
    // хвост панели вырезается из кэпа на хосте: больший хвост был бы обещанием,
    // которое shell не может выполнить
    throw new Error(
      `Invalid DEPLOY_HOST_LOG_BYTES=${env.DEPLOY_HOST_LOG_BYTES}: must be >= DEPLOY_LOG_TAIL_BYTES (${deploy.logTailBytes})`,
    );
  }

  return {
    app: { port, isProduction, trustProxy: parseTrustProxy(env.TRUST_PROXY) },
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
      sshOps: parseThrottle(env, 'THROTTLE_SSH_OPS', {
        limit: 6,
        ttlMs: 60000,
      }),
      // Чтения Docker (списки, детали, логи, stats) — частые и дешёвые для
      // панели, но каждый стоит SSH-канала к хосту клиента.
      dockerReads: parseThrottle(env, 'THROTTLE_DOCKER_READS', {
        limit: 60,
        ttlMs: 60000,
      }),
    },
    ssh,
    docker,
    deploy,
    crypto: parseCrypto(env, isProduction),
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
      // Дефолт 1500: живой MX отвечает за 20–200мс; всё дольше — мёртвый
      // домен или больная сеть, где fail-closed честен. Первый запрос с
      // нового домена — единственный, кто ждёт; дальше работает MX-кэш.
      mxTimeoutMs: positiveInt(env.EMAIL_MX_TIMEOUT_MS, 'EMAIL_MX_TIMEOUT_MS', {
        min: 1,
        fallback: 1500,
      }),
      extraBlockedDomains: parseDomainList(env.EMAIL_EXTRA_BLOCKED_DOMAINS),
    },
    invitations: {
      ttlSec: positiveInt(env.INVITATION_TTL_SEC, 'INVITATION_TTL_SEC', {
        min: 1,
        max: 2592000,
        fallback: 86400,
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
