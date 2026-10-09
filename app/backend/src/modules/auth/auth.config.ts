import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  createHash,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isSecureCookies } from './auth-cookies';

export const JWT_ALGORITHM = 'RS256' as const;

export interface AuthConfig {
  algorithm: typeof JWT_ALGORITHM;
  /** PKCS#8 / PKCS#1 PEM закрытого RSA-ключа. Никогда не логировать и не отдавать наружу. */
  privateKey: string;
  /** SPKI PEM открытого RSA-ключа. */
  publicKey: string;
  /** sha256-hex открытого ключа — безопасный идентификатор для логов. */
  publicKeyFingerprint: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  issuer: string;
  audience: string;
  clockToleranceSec: number;
  cookieSecure: boolean;
  isProduction: boolean;
  /** true, если ключи сгенерированы эфемерно (только non-production). */
  ephemeralKeys: boolean;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

function readPemEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Поддерживаем как реальные переносы, так и экранированные "\n" из env.
  const pem = value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
  return pem.trim() ? pem : undefined;
}

function parsePositiveInt(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}="${raw}": expected positive integer`);
  }
  return parsed;
}

function parseRsaPrivateKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new Error('Invalid JWT private key: not a parseable PEM private key');
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'rsa') {
    throw new Error(
      'Invalid JWT private key: expected RSA private key (PKCS#8/PKCS#1 PEM)',
    );
  }
  const details = key.asymmetricKeyDetails;
  if (details?.modulusLength !== undefined && details.modulusLength < 2048) {
    throw new Error('Invalid JWT private key: RSA modulus < 2048 bits');
  }
  return key;
}

function parseRsaPublicKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: pem, format: 'pem' });
  } catch {
    throw new Error('Invalid JWT public key: not a parseable PEM public key');
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa') {
    throw new Error(
      'Invalid JWT public key: expected RSA public key (SPKI PEM)',
    );
  }
  return key;
}

/** Проверяет, что ключи — пара: открытый выводится из закрытого и roundtrip sign/verify работает. */
export function assertKeyPair(
  privatePem: string,
  publicPem: string,
): { fingerprint: string } {
  const privateKey = parseRsaPrivateKey(privatePem);
  const publicKey = parseRsaPublicKey(publicPem);

  const derived = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const normalize = (pem: string) => pem.replace(/\r\n/g, '\n').trim();
  if (normalize(derived) !== normalize(publicPem)) {
    throw new Error(
      'JWT key mismatch: public key does not correspond to private key',
    );
  }

  // Roundtrip: подпись закрытым обязана проверяться открытым.
  const probe = Buffer.from('bios-keypair-probe');
  const signature = createSign('sha256').update(probe).sign(privateKey);
  if (!createVerify('sha256').update(probe).verify(publicKey, signature)) {
    throw new Error('JWT key mismatch: sign/verify roundtrip failed');
  }

  const fingerprint = createHash('sha256')
    .update(normalize(publicPem))
    .digest('hex');
  return { fingerprint };
}

function loadKeyMaterial(
  env: NodeJS.ProcessEnv,
): { privateKey: string; publicKey: string } | undefined {
  const fromEnvPrivate = readPemEnv(env.JWT_PRIVATE_KEY);
  const fromEnvPublic = readPemEnv(env.JWT_PUBLIC_KEY);
  if (fromEnvPrivate || fromEnvPublic) {
    if (!fromEnvPrivate || !fromEnvPublic) {
      throw new Error(
        'JWT keys misconfigured: provide both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY',
      );
    }
    return { privateKey: fromEnvPrivate, publicKey: fromEnvPublic };
  }

  const privatePath = env.JWT_PRIVATE_KEY_PATH;
  const publicPath = env.JWT_PUBLIC_KEY_PATH;
  if (privatePath || publicPath) {
    if (!privatePath || !publicPath) {
      throw new Error(
        'JWT keys misconfigured: provide both JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH',
      );
    }
    try {
      return {
        privateKey: readFileSync(privatePath, 'utf8'),
        publicKey: readFileSync(publicPath, 'utf8'),
      };
    } catch (err) {
      throw new Error(`JWT keys unreadable: ${(err as Error).message}`);
    }
  }

  return undefined;
}

export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const isProduction = env.NODE_ENV === 'production';
  const provided = loadKeyMaterial(env);

  let privateKey: string;
  let publicKey: string;
  let ephemeralKeys = false;

  if (!provided) {
    if (isProduction) {
      throw new Error(
        'JWT keys missing: set JWT_PRIVATE_KEY/JWT_PUBLIC_KEY or JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH',
      );
    }
    // Dev/test удобство: эфемерная пара в памяти, явно помеченная. Не silent fallback —
    // предупреждаем в лог, в production такой путь запрещён исключением выше.

    console.warn(
      '[auth] No JWT keys configured — generated ephemeral RSA keypair (dev only, tokens invalid after restart)',
    );
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    ephemeralKeys = true;
  } else {
    privateKey = provided.privateKey;
    publicKey = provided.publicKey;
  }

  const { fingerprint } = assertKeyPair(privateKey, publicKey);

  return {
    algorithm: JWT_ALGORITHM,
    privateKey,
    publicKey,
    publicKeyFingerprint: fingerprint,
    accessTtlSec: parsePositiveInt(
      env.JWT_ACCESS_TTL_SEC,
      'JWT_ACCESS_TTL_SEC',
      600,
    ),
    refreshTtlSec: parsePositiveInt(
      env.JWT_REFRESH_TTL_SEC,
      'JWT_REFRESH_TTL_SEC',
      604800,
    ),
    issuer: env.JWT_ISSUER || 'bios',
    audience: env.JWT_AUDIENCE || 'bios-api',
    clockToleranceSec: parsePositiveInt(
      env.JWT_CLOCK_TOLERANCE_SEC,
      'JWT_CLOCK_TOLERANCE_SEC',
      5,
    ),
    cookieSecure: isSecureCookies(env),
    isProduction,
    ephemeralKeys,
  };
}
