import { promises as dns } from 'node:dns';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import disposableDomains from 'disposable-email-domains';

// 121k+ доменов из поддерживаемого репозитория
// (github.com/disposable/disposable-email-domains). Строится один раз.
const DISPOSABLE_SET = new Set(disposableDomains.map((d) => d.toLowerCase()));

function extraBlockedDomains(): Set<string> {
  return new Set(
    (process.env.EMAIL_EXTRA_BLOCKED_DOMAINS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
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

async function hasMxRecords(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'isNotDisposableEmail', async: true })
class IsNotDisposableEmailConstraint implements ValidatorConstraintInterface {
  async validate(email: unknown): Promise<boolean> {
    if (typeof email !== 'string') return false;
    const domain = domainOf(email.trim().toLowerCase());
    if (!domain) return false;
    if (isDisposableDomain(domain)) return false;
    // Опциональная строгая проверка (по умолчанию выключена: требует DNS,
    // ломается в офлайне). При включении отсутствие MX = отказ.
    if (process.env.EMAIL_VERIFY_MX === 'true') {
      return hasMxRecords(domain);
    }
    return true;
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
