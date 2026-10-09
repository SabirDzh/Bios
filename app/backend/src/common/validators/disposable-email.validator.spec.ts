import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateUserDto } from '../../modules/users/dto/create-user.dto';
import { isDisposableDomain } from './disposable-email.validator';

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
