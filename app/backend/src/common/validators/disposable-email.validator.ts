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
  return new Set(getAppConfig().email.extraBlockedDomains);
}

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
    return hasMxRecords(domain);
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
