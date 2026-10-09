import { createHash } from 'node:crypto';
import { hostKeyFingerprint } from './host-key';

describe('hostKeyFingerprint', () => {
  test('совпадает с OpenSSH-форматом base64(sha256(blob)) без padding', () => {
    const blob = Buffer.from([
      0x00, 0x00, 0x00, 0x07, 0x73, 0x73, 0x68, 0x2d, 0x72, 0x73, 0x61,
    ]);
    const expected = `SHA256:${createHash('sha256')
      .update(blob)
      .digest('base64')
      .replace(/=+$/, '')}`;
    expect(hostKeyFingerprint(blob)).toBe(expected);
    expect(hostKeyFingerprint(blob)).not.toContain('=');
  });

  test('разные ключи дают разные отпечатки, формат SHA256:<43 символа>', () => {
    const a = hostKeyFingerprint(Buffer.from('key-a'));
    const b = hostKeyFingerprint(Buffer.from('key-b'));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});
