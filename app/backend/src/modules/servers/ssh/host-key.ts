import { createHash } from 'node:crypto';

/** OpenSSH-совместимый отпечаток: base64(sha256(wire-blob)) без паддинга, префикс SHA256:. */
export function hostKeyFingerprint(rawKey: Buffer): string {
  return `SHA256:${createHash('sha256')
    .update(rawKey)
    .digest('base64')
    .replace(/=+$/, '')}`;
}
