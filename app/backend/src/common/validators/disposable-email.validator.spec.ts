import { promises as dns } from 'node:dns';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateUserDto } from '../../modules/users/dto/create-user.dto';
import {
  clearMxCacheForTests,
  hasMxRecords,
  hasMxRecordsCached,
  isDisposableDomain,
} from './disposable-email.validator';
import { reloadAppConfigForTests } from '../../config/app-config.module';

jest.mock('node:dns', () => ({
  promises: { resolveMx: jest.fn() },
}));

const resolveMx = dns.resolveMx as jest.Mock;
const MX = [{ exchange: 'mail.example.com', priority: 10 }];

async function emailErrors(email: string): Promise<string[]> {
  const dto = plainToInstance(CreateUserDto, {
    username: 'validname',
    email,
    password: 'secret123',
  });
  const errors = await validate(dto);
  const emailErr = errors.find((e) => e.property === 'email');
  return emailErr ? Object.values(emailErr.constraints ?? {}) : [];
}

describe('disposable email blocking', () => {
  beforeEach(() => {
    resolveMx.mockReset();
    resolveMx.mockResolvedValue(MX);
    delete process.env.EMAIL_VERIFY_MX;
    delete process.env.EMAIL_EXTRA_BLOCKED_DOMAINS;
    reloadAppConfigForTests();
  });

  test('isDisposableDomain: exact, subdomain, case-insensitive', () => {
    expect(isDisposableDomain('mailinator.com')).toBe(true);
    expect(isDisposableDomain('sub.mailinator.com')).toBe(true);
    expect(isDisposableDomain('Mailinator.COM')).toBe(true);
    expect(isDisposableDomain('gmail.com')).toBe(false);
    expect(isDisposableDomain('mycompany.io')).toBe(false);
  });

  test('registration with temp mail is rejected', async () => {
    expect(await emailErrors('user@mailinator.com')).toContain(
      'email must not use a disposable email address',
    );
    expect(await emailErrors('user@sub.10minutemail.com')).toContain(
      'email must not use a disposable email address',
    );
  });

  test('normal emails pass', async () => {
    expect(await emailErrors('user@gmail.com')).toEqual([]);
    expect(await emailErrors('User@Example.COM')).toEqual([]);
  });

  test('extra blocked domains via env', async () => {
    process.env.EMAIL_EXTRA_BLOCKED_DOMAINS = 'evil-corp.example, spam.io';
    reloadAppConfigForTests();
    try {
      expect(isDisposableDomain('evil-corp.example')).toBe(true);
      expect(isDisposableDomain('x.spam.io')).toBe(true);
      expect(await emailErrors('user@evil-corp.example')).toContain(
        'email must not use a disposable email address',
      );
    } finally {
      delete process.env.EMAIL_EXTRA_BLOCKED_DOMAINS;
    }
  });
});

describe('MX record check', () => {
  beforeEach(() => {
    resolveMx.mockReset();
    delete process.env.EMAIL_VERIFY_MX;
    delete process.env.EMAIL_MX_TIMEOUT_MS;
    reloadAppConfigForTests();
    clearMxCacheForTests();
  });

  test('hasMxRecords: true with MX, false without or on DNS error', async () => {
    resolveMx.mockResolvedValueOnce(MX);
    await expect(hasMxRecords('gmail.com')).resolves.toBe(true);

    resolveMx.mockResolvedValueOnce([]);
    await expect(hasMxRecords('gmail.com')).resolves.toBe(false);

    resolveMx.mockRejectedValueOnce(
      Object.assign(new Error('queryMx ENOTFOUND'), { code: 'ENOTFOUND' }),
    );
    await expect(hasMxRecords('nonexistent.invalid')).resolves.toBe(false);
  });

  test('hasMxRecords: timeout fails closed', async () => {
    process.env.EMAIL_MX_TIMEOUT_MS = '50';
    reloadAppConfigForTests();
    resolveMx.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(hasMxRecords('slow.example.com')).resolves.toBe(false);
    expect(resolveMx).toHaveBeenCalledWith('slow.example.com');
  });

  test('domain without MX is rejected on registration (fail closed)', async () => {
    resolveMx.mockResolvedValue([]);
    expect(await emailErrors('user@gmail.con')).toContain(
      'email domain must accept mail (MX record not found)',
    );
  });

  test('EMAIL_VERIFY_MX=false disables the check', async () => {
    process.env.EMAIL_VERIFY_MX = 'false';
    reloadAppConfigForTests();
    resolveMx.mockRejectedValue(new Error('offline'));
    const dto = plainToInstance(CreateUserDto, {
      username: 'validname',
      email: 'user@gmail.com',
      password: 'secret123',
    });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'email')).toBeUndefined();
  });
});

describe('MX cache', () => {
  beforeEach(() => {
    resolveMx.mockReset();
    resolveMx.mockResolvedValue(MX);
    delete process.env.EMAIL_VERIFY_MX;
    delete process.env.EMAIL_MX_TIMEOUT_MS;
    reloadAppConfigForTests();
    clearMxCacheForTests();
  });

  test('allowlisted providers skip DNS entirely', async () => {
    await expect(hasMxRecordsCached('gmail.com')).resolves.toBe(true);
    await expect(hasMxRecordsCached('Outlook.COM')).resolves.toBe(true);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  test('positive result is cached: one DNS query for repeats', async () => {
    await expect(hasMxRecordsCached('corp.example.com')).resolves.toBe(true);
    await expect(hasMxRecordsCached('corp.example.com')).resolves.toBe(true);
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  test('negative result is cached (fail closed preserved)', async () => {
    resolveMx.mockResolvedValue([]);
    await expect(hasMxRecordsCached('dead.example.com')).resolves.toBe(false);
    await expect(hasMxRecordsCached('dead.example.com')).resolves.toBe(false);
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  test('concurrent queries for one domain deduplicate in-flight', async () => {
    const [a, b] = await Promise.all([
      hasMxRecordsCached('burst.example.com'),
      hasMxRecordsCached('burst.example.com'),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });
});
