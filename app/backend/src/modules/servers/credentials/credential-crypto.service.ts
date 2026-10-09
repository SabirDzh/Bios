import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';

const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** SSH-креденшелы серверов живут в БД только как AEAD-cipher с идентификатором ключа. */
@Injectable()
export class CredentialCryptoService {
  private static readonly logger = new Logger(CredentialCryptoService.name);

  private readonly activeId: string;
  private readonly activeKey: Buffer;
  private readonly keys: Map<string, Buffer>;

  /** true, если настроен хотя бы один старый ключ — cipher прошлого поколения читаем. */
  readonly oldKeysAllowed: boolean;

  constructor(@Inject(APP_CONFIG) app: AppConfig) {
    if (app.crypto.ephemeralServerKey) {
      CredentialCryptoService.logger.warn(
        'SERVER_CRYPTO_KEY is not set: generated an ephemeral key, stored server credentials will not survive a restart',
      );
    }
    this.activeId = app.crypto.activeKey.id;
    this.activeKey = app.crypto.activeKey.key;
    if (this.activeKey.length !== KEY_BYTES) {
      throw new Error(
        `Invalid server crypto key: expected ${KEY_BYTES} bytes, got ${this.activeKey.length}`,
      );
    }
    this.keys = new Map(app.crypto.oldKeys);
    this.keys.set(this.activeId, this.activeKey);
    this.oldKeysAllowed = app.crypto.oldKeys.size > 0;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.activeKey, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      CIPHER_VERSION,
      this.activeId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }

  /** cipher другого поколения: читается, но его стоит переписать активным ключом. */
  needsRewrap(value: string): boolean {
    const [version, kid] = value.split('.');
    return (
      version === CIPHER_VERSION && kid !== undefined && kid !== this.activeId
    );
  }

  decrypt(value: string): string {
    const [version, kid, ivPart, tagPart, dataPart] = value.split('.');
    if (
      version !== CIPHER_VERSION ||
      !kid ||
      !ivPart ||
      !tagPart ||
      !dataPart
    ) {
      throw new Error('credential cipher malformed');
    }
    const key = this.keys.get(kid);
    if (!key) {
      throw new Error(`credential encrypted with unknown key id "${kid}"`);
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivPart, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('credential decryption failed');
    }
  }
}
