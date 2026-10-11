import {
  DEFAULT_CONNECTION_LIMIT,
  parseConnectionLimit,
  withConnectionLimit,
} from './prisma.service';

describe('withConnectionLimit', () => {
  test('appends given limit to plain URL', () => {
    expect(
      withConnectionLimit('postgresql://u@h:5432/db', DEFAULT_CONNECTION_LIMIT),
    ).toBe(
      `postgresql://u@h:5432/db?connection_limit=${DEFAULT_CONNECTION_LIMIT}`,
    );
  });

  test('appends with & when URL already has params', () => {
    expect(
      withConnectionLimit(
        'postgresql://u@h:5432/db?schema=public',
        DEFAULT_CONNECTION_LIMIT,
      ),
    ).toBe(
      `postgresql://u@h:5432/db?schema=public&connection_limit=${DEFAULT_CONNECTION_LIMIT}`,
    );
  });

  test('respects explicit connection_limit in URL', () => {
    const url = 'postgresql://u@h:5432/db?connection_limit=25&schema=public';
    expect(withConnectionLimit(url, DEFAULT_CONNECTION_LIMIT)).toBe(url);
  });

  test('passes undefined through (Prisma falls back to env)', () => {
    expect(
      withConnectionLimit(undefined, DEFAULT_CONNECTION_LIMIT),
    ).toBeUndefined();
  });
});

describe('parseConnectionLimit', () => {
  test('missing or empty means default', () => {
    expect(parseConnectionLimit(undefined)).toBe(DEFAULT_CONNECTION_LIMIT);
    expect(parseConnectionLimit('')).toBe(DEFAULT_CONNECTION_LIMIT);
  });

  test('valid value passes through', () => {
    expect(parseConnectionLimit('1')).toBe(1);
    expect(parseConnectionLimit('25')).toBe(25);
  });

  test('garbage fails fast', () => {
    for (const bad of ['0', '101', '-5', 'abc', '2.5']) {
      expect(() => parseConnectionLimit(bad)).toThrow(
        'Invalid DB_CONNECTION_LIMIT',
      );
    }
  });
});
