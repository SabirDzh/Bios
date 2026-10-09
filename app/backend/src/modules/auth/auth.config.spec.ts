import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertKeyPair, loadAuthConfig } from './auth.config';

function genPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('auth.config RSA keys', () => {
  test('assertKeyPair accepts matching pair and returns 64-hex fingerprint', () => {
    const { privateKey, publicKey } = genPair();
    const { fingerprint } = assertKeyPair(privateKey, publicKey);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('assertKeyPair rejects mismatched pair', () => {
    const a = genPair();
    const b = genPair();
    expect(() => assertKeyPair(a.privateKey, b.publicKey)).toThrow(/mismatch/);
  });

  test('assertKeyPair rejects garbage PEM', () => {
    const { publicKey } = genPair();
    expect(() => assertKeyPair('not-a-key', publicKey)).toThrow(/private key/);
    const { privateKey } = genPair();
    expect(() => assertKeyPair(privateKey, 'not-a-key')).toThrow(/public key/);
  });

  test('assertKeyPair rejects non-RSA key', () => {
    const ec = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(() => assertKeyPair(ec.privateKey, ec.publicKey)).toThrow(/RSA/);
  });

  test('dev without keys generates ephemeral pair with explicit flag', () => {
    const config = loadAuthConfig({ NODE_ENV: 'test' });
    expect(config.ephemeralKeys).toBe(true);
    expect(config.algorithm).toBe('RS256');
    expect(config.privateKey).toContain('PRIVATE KEY');
    expect(config.publicKey).toContain('PUBLIC KEY');
  });

  test('production without keys fails fast', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(/missing/);
  });

  test('half-configured keys fail fast', () => {
    const { privateKey } = genPair();
    expect(() =>
      loadAuthConfig({
        NODE_ENV: 'test',
        JWT_PRIVATE_KEY: privateKey,
      }),
    ).toThrow(/both/);
  });

  test('PEM from env with escaped newlines is accepted', () => {
    const { privateKey, publicKey } = genPair();
    const config = loadAuthConfig({
      NODE_ENV: 'test',
      JWT_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      JWT_PUBLIC_KEY: publicKey.replace(/\n/g, '\\n'),
    });
    expect(config.ephemeralKeys).toBe(false);
    expect(config.publicKey).toContain('PUBLIC KEY');
  });

  test('keys from files are accepted; missing file fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bios-keys-'));
    const { privateKey, publicKey } = genPair();
    writeFileSync(join(dir, 'private.pem'), privateKey);
    writeFileSync(join(dir, 'public.pem'), publicKey);
    const config = loadAuthConfig({
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY_PATH: join(dir, 'private.pem'),
      JWT_PUBLIC_KEY_PATH: join(dir, 'public.pem'),
    });
    expect(config.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);

    expect(() =>
      loadAuthConfig({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: join(dir, 'nope.pem'),
        JWT_PUBLIC_KEY_PATH: join(dir, 'public.pem'),
      }),
    ).toThrow(/unreadable/);
  });

  test('invalid TTL values fail fast', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      expect(() =>
        loadAuthConfig({
          NODE_ENV: 'test',
          JWT_ACCESS_TTL_SEC: bad,
        }),
      ).toThrow(/JWT_ACCESS_TTL_SEC/);
    }
    const config = loadAuthConfig({
      NODE_ENV: 'test',
      JWT_ACCESS_TTL_SEC: '300',
      JWT_REFRESH_TTL_SEC: '3600',
    });
    expect(config.accessTtlSec).toBe(300);
    expect(config.refreshTtlSec).toBe(3600);
  });
});
