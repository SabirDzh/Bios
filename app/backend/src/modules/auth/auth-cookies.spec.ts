import type { Response } from 'express';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  COOKIE_PATH,
  buildCookieOptions,
  clearPairCookies,
  setPairCookies,
  type CookieFlags,
} from './auth-cookies';

const FLAGS: CookieFlags = {
  cookieSecure: true,
  accessTtlSec: 600,
  refreshTtlSec: 604800,
  sameSite: 'lax',
  path: '/',
};

function mockRes() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const res = { cookie, clearCookie } as unknown as Response;
  return { res, cookie, clearCookie };
}

describe('auth-cookies', () => {
  test('single source: names and path constants', () => {
    expect(ACCESS_COOKIE_NAME).toBe('access_token');
    expect(REFRESH_COOKIE_NAME).toBe('refresh_token');
    expect(COOKIE_PATH).toBe('/');
  });

  test('setPairCookies uses names, TTLs and flags from config', () => {
    const { res, cookie } = mockRes();
    setPairCookies(res, FLAGS, { accessToken: 'a', refreshToken: 'r' });
    expect(cookie).toHaveBeenCalledWith(
      'refresh_token',
      'r',
      expect.objectContaining({
        maxAge: 604800000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'a',
      expect.objectContaining({ maxAge: 600000 }),
    );
  });

  test('clearPairCookies clears both with identical flags', () => {
    const { res, clearCookie } = mockRes();
    clearPairCookies(res, FLAGS);
    const opts = buildCookieOptions(FLAGS, 0);
    expect(clearCookie).toHaveBeenCalledWith('access_token', opts);
    expect(clearCookie).toHaveBeenCalledWith('refresh_token', opts);
  });
});
