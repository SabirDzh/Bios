import { CredentialCryptoService } from './credential-crypto.service';
import type { AppConfig } from '../../../config/app.config';

const KEY_A = Buffer.alloc(32, 7);
const KEY_B = Buffer.alloc(32, 8);
const PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaQr\n-----END OPENSSH PRIVATE KEY-----\n';

function cfg(
  active: { id: string; key: Buffer },
  old: Record<string, Buffer> = {},
): AppConfig {
  return {
    crypto: {
      activeKey: active,
      oldKeys: new Map(Object.entries(old)),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

describe('CredentialCryptoService', () => {
  test('roundtrip сохраняет плейнтекст, включая юникод и переводы строк', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    expect(s.decrypt(s.encrypt(PEM))).toBe(PEM);
    expect(s.decrypt(s.encrypt('привет pass'))).toBe('привет pass');
  });

  test('формат v1.<kid>.<iv>.<tag>.<data>, плейнтекста в cipher нет', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k7', key: KEY_A }));
    const cipher = s.encrypt('secret1234');
    expect(cipher.startsWith('v1.k7.')).toBe(true);
    expect(cipher.split('.')).toHaveLength(5);
    expect(cipher).not.toContain('secret1234');
  });

  test('один и тот же плейнтекст даёт разный cipher (уникальный IV)', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    expect(s.encrypt('secret1234')).not.toBe(s.encrypt('secret1234'));
  });

  test('ротация: старый kid читается, новый пишется, needsRewrap=true', () => {
    const before = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    const cipher = before.encrypt('secret1234');

    const after = new CredentialCryptoService(
      cfg({ id: 'k2', key: KEY_B }, { k1: KEY_A }),
    );
    expect(after.decrypt(cipher)).toBe('secret1234');
    expect(after.needsRewrap(cipher)).toBe(true);
    expect(after.oldKeysAllowed).toBe(true);
    expect(before.oldKeysAllowed).toBe(false);

    const rewritten = after.encrypt(after.decrypt(cipher));
    expect(rewritten.startsWith('v1.k2.')).toBe(true);
    expect(after.needsRewrap(rewritten)).toBe(false);
    // Без настроенного старого ключа cipher прошлого поколения не читается.
    expect(() =>
      new CredentialCryptoService(cfg({ id: 'k2', key: KEY_B })).decrypt(
        cipher,
      ),
    ).toThrow(/unknown key id/);
  });

  test('неизвестный kid и чужой ключ падают, а не возвращают мусор', () => {
    const cipher = new CredentialCryptoService(
      cfg({ id: 'k1', key: KEY_A }),
    ).encrypt('secret1234');
    expect(() =>
      new CredentialCryptoService(cfg({ id: 'k1', key: KEY_B })).decrypt(
        cipher,
      ),
    ).toThrow('credential decryption failed');
    expect(() =>
      new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A })).decrypt(
        'v1.zz.aaa.bbb.ccc',
      ),
    ).toThrow(/unknown key id/);
  });

  test('подмена ciphertext и мусор на входе падают', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    const cipher = s.encrypt('secret1234');
    const tampered =
      cipher.slice(0, -2) + (cipher.endsWith('AA') ? 'BB' : 'AA');
    expect(() => s.decrypt(tampered)).toThrow('credential decryption failed');
    expect(() => s.decrypt('not-a-cipher')).toThrow(
      'credential cipher malformed',
    );
    expect(() => s.decrypt('v2.k1.aaa.bbb.ccc')).toThrow(
      'credential cipher malformed',
    );
  });

  test('нуждающийся в перевёртке kid не путается с корректным', () => {
    const s = new CredentialCryptoService(
      cfg({ id: 'k1', key: KEY_A }, { k0: KEY_B }),
    );
    expect(s.needsRewrap(s.encrypt('secret1234'))).toBe(false);
    expect(s.needsRewrap('v1.k0.aaa.bbb.ccc')).toBe(true);
    expect(s.needsRewrap('garbage')).toBe(false);
  });

  test('ключ не-32 байта падает при создании сервиса', () => {
    expect(
      () =>
        new CredentialCryptoService(cfg({ id: 'k1', key: Buffer.alloc(16) })),
    ).toThrow(/32 bytes/);
  });
});
