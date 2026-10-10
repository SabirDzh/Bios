import { promises as dns } from 'node:dns';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import disposableDomains from 'disposable-email-domains';
import { getAppConfig } from '../../config/app-config.module';

// 121k+ доменов из поддерживаемого репозитория
// (github.com/disposable/disposable-email-domains). Строится один раз.
const DISPOSABLE_SET = new Set(disposableDomains.map((d) => d.toLowerCase()));

function extraBlockedDomains(): Set<string> {
  // Мемоизация по идентичности массива: конфиг иммутабелен между
  // reloadAppConfigForTests, поэтому пересборки Set на каждый вызов нет,
  // а тесты с новым env всё равно видят свежий список.
  const list = getAppConfig().email.extraBlockedDomains;
  if (!extraCache || extraCache.list !== list) {
    extraCache = { list, set: new Set(list) };
  }
  return extraCache.set;
}

let extraCache: { list: string[]; set: Set<string> } | undefined;

function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}

/** Проверяет домен и все родительские суффиксы: sub.mailinator.com -> mailinator.com. */
export function isDisposableDomain(domain: string): boolean {
  const extra = extraBlockedDomains();
  const parts = domain.toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DISPOSABLE_SET.has(candidate) || extra.has(candidate)) {
      return true;
    }
  }
  return false;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function mxTimeoutMs(): number {
  return getAppConfig().email.mxTimeoutMs;
}

/** Проверяет наличие MX-записей у домена. Экспортирована для тестов. */
export async function hasMxRecords(domain: string): Promise<boolean> {
  try {
    const records = await withTimeout(dns.resolveMx(domain), mxTimeoutMs());
    return records.length > 0;
  } catch {
    return false;
  }
}

// Кэш MX-ответов: записи меняются редко, а каждый miss держит регистрацию
// до таймаута. Positive TTL длинный, negative короткий (свежий домен может
// получить MX). In-flight дедуп: пачка регистраций с одного корпоративного
// домена даёт один DNS-запрос. Мульти-инстанс не проблема: под кэшем всё
// равно системный DNS-кэш, расхождение — в пределах TTL.
const MX_POSITIVE_TTL_MS = 24 * 3600 * 1000;
const MX_NEGATIVE_TTL_MS = 10 * 60 * 1000;
const MX_CACHE_MAX = 5000;

const mxCache = new Map<string, { ok: boolean; at: number }>();
const mxPending = new Map<string, Promise<boolean>>();

/** Крупные провайдеры: MX заведомо есть, DNS-запрос не нужен вообще. */
const MX_ALLOWLIST = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yandex.ru',
  'ya.ru',
  'mail.ru',
  'bk.ru',
  'inbox.ru',
  'list.ru',
  'proton.me',
  'protonmail.com',
]);

export async function hasMxRecordsCached(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (MX_ALLOWLIST.has(key)) return true;
  const hit = mxCache.get(key);
  if (
    hit &&
    Date.now() - hit.at < (hit.ok ? MX_POSITIVE_TTL_MS : MX_NEGATIVE_TTL_MS)
  ) {
    return hit.ok;
  }
  const inflight = mxPending.get(key);
  if (inflight) return inflight;
  const query = hasMxRecords(key).finally(() => {
    mxPending.delete(key);
  });
  mxPending.set(key, query);
  const ok = await query;
  if (!mxCache.has(key) && mxCache.size >= MX_CACHE_MAX) {
    const oldest = mxCache.keys().next();
    if (!oldest.done) mxCache.delete(oldest.value);
  }
  mxCache.set(key, { ok, at: Date.now() });
  return ok;
}

/** Сброс MX-кэша — только для тестов. */
export function clearMxCacheForTests(): void {
  mxCache.clear();
  mxPending.clear();
}

@ValidatorConstraint({ name: 'isNotDisposableEmail' })
class IsNotDisposableEmailConstraint implements ValidatorConstraintInterface {
  validate(email: unknown): boolean {
    if (typeof email !== 'string') return false;
    const domain = domainOf(email.trim().toLowerCase());
    if (!domain) return false;
    return !isDisposableDomain(domain);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not use a disposable email address`;
  }
}

export function IsNotDisposableEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsNotDisposableEmailConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isDeliverableEmail', async: true })
class IsDeliverableEmailConstraint implements ValidatorConstraintInterface {
  async validate(email: unknown): Promise<boolean> {
    if (!getAppConfig().email.verifyMx) return true;
    if (typeof email !== 'string') return false;
    const domain = domainOf(email.trim().toLowerCase());
    if (!domain) return false;
    // Fail closed: нет MX, DNS-ошибка или таймаут — отказ в регистрации.
    // Идём через кэш: повторные домены не ждут DNS заново.
    return hasMxRecordsCached(domain);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} domain must accept mail (MX record not found)`;
  }
}

export function IsDeliverableEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsDeliverableEmailConstraint,
    });
  };
}
