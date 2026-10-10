import {
  DEFAULT_CONNECTION_LIMIT,
  withConnectionLimit,
} from './prisma.service';

describe('withConnectionLimit', () => {
  test('appends default limit to plain URL', () => {
    expect(withConnectionLimit('postgresql://u@h:5432/db')).toBe(
      `postgresql://u@h:5432/db?connection_limit=${DEFAULT_CONNECTION_LIMIT}`,
    );
  });

  test('appends with & when URL already has params', () => {
    expect(withConnectionLimit('postgresql://u@h:5432/db?schema=public')).toBe(
      `postgresql://u@h:5432/db?schema=public&connection_limit=${DEFAULT_CONNECTION_LIMIT}`,
    );
  });

  test('respects explicit connection_limit in URL', () => {
    const url = 'postgresql://u@h:5432/db?connection_limit=25&schema=public';
    expect(withConnectionLimit(url)).toBe(url);
  });

  test('passes undefined through (Prisma falls back to env)', () => {
    expect(withConnectionLimit(undefined)).toBeUndefined();
  });
});
