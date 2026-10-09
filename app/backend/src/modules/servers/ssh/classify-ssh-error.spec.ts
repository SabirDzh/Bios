import { classifySshError } from './classify-ssh-error';

function err(message: string, code?: string): Error & { code?: string } {
  const e = new Error(message) as Error & { code?: string };
  e.code = code;
  return e;
}

describe('classifySshError', () => {
  test('аутентификация, handshake-таймаут и DNS различимы', () => {
    expect(
      classifySshError(err('All configured authentication methods failed')),
    ).toBe('AUTH_FAILED');
    expect(classifySshError(err('Timed out while waiting for handshake'))).toBe(
      'TIMEOUT',
    );
    expect(classifySshError(err('', 'ETIMEDOUT'))).toBe('TIMEOUT');
    expect(classifySshError(err('getaddrinfo ENOTFOUND nowhere.invalid'))).toBe(
      'DNS',
    );
    expect(classifySshError('EAI_AGAIN example.com')).toBe('DNS');
  });

  test('ECONNRESET — это NETWORK, а не TIMEOUT (замечание ревью №11)', () => {
    expect(classifySshError(err('socket hang up', 'ECONNRESET'))).toBe(
      'NETWORK',
    );
    expect(classifySshError(err('Connection reset by peer'))).toBe('NETWORK');
  });

  test('отказ в соединении и проблема с host key', () => {
    expect(classifySshError(err('connect ECONNREFUSED 127.0.0.1:22'))).toBe(
      'REFUSED',
    );
    expect(classifySshError(err('Received mismatching host key'))).toBe(
      'HOST_KEY',
    );
  });

  test('сбой аутентификации важнее общего слова timeout в тексте', () => {
    expect(
      classifySshError(
        err('All configured authentication methods failed after timeout'),
      ),
    ).toBe('AUTH_FAILED');
  });

  test('всё остальное — NETWORK, включая неизвестные формы', () => {
    expect(classifySshError(err('something strange'))).toBe('NETWORK');
    expect(classifySshError(undefined)).toBe('NETWORK');
    expect(classifySshError({ nope: true })).toBe('NETWORK');
  });
});
