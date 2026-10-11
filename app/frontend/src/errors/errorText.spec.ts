import { describe, expect, test } from 'vitest';
import { ApiError } from '../api/client';
import { apiErrorCode, codeText, errorText } from './errorText';

const apiError = (status: number, message: string, payload?: unknown) =>
  new ApiError(status, message, payload);

describe('errorText', () => {
  test('login 401 → общий текст без раскрытия деталей', () => {
    expect(errorText(apiError(401, 'Unauthorized'), 'login')).toBe(
      'Неверный email или пароль.',
    );
  });

  test('login 429 → троттлинг', () => {
    expect(errorText(apiError(429, 'ThrottlerException'), 'login')).toContain(
      'Слишком много попыток',
    );
  });

  test('accept 404 → приглашение недействительно', () => {
    expect(errorText(apiError(404, 'Not Found'), 'accept')).toContain(
      'не найдено, истекло или отозвано',
    );
  });

  test('accept 403 → чужой email', () => {
    expect(errorText(apiError(403, 'Forbidden'), 'accept')).toContain(
      'на другой адрес',
    );
  });

  test('invite 409 → уже участник', () => {
    expect(errorText(apiError(409, 'already a member'), 'invite')).toContain(
      'уже участвует',
    );
  });

  test('424 с errorCode → словарь кодов', () => {
    expect(
      errorText(
        apiError(424, 'host key is not trusted yet', {
          statusCode: 424,
          errorCode: 'HOST_KEY_NOT_TRUSTED',
          message: 'host key is not trusted yet',
        }),
      ),
    ).toBe('Отпечаток ключа хоста не подтверждён.');
  });

  test('504 TIMEOUT → словарь кодов', () => {
    expect(
      errorText(
        apiError(504, 'deadline', {
          statusCode: 504,
          errorCode: 'TIMEOUT',
          message: 'deadline',
        }),
      ),
    ).toBe('Превышено время ожидания ответа от сервера.');
  });

  test('не-ApiError (сеть) → нет соединения', () => {
    expect(errorText(new TypeError('Failed to fetch'))).toContain(
      'Нет соединения',
    );
  });

  test('400 с массивом message → склейка серверных строк', () => {
    expect(
      errorText(apiError(400, 'validation', {
        statusCode: 400,
        message: ['name is too long', 'repoUrl is required'],
      })),
    ).toBe('name is too long; repoUrl is required');
  });

  test('5xx без кода → ошибка панели', () => {
    expect(errorText(apiError(500, 'Internal server error'))).toBe(
      'Ошибка панели. Попробуйте ещё раз.',
    );
  });

  test('serverCreate 409 → занятое имя или отпечаток', () => {
    expect(
      errorText(apiError(409, 'server name already used'), 'serverCreate'),
    ).toContain('уже занято');
  });

  test('serverCreate 403 → только владелец', () => {
    expect(errorText(apiError(403, 'Forbidden'), 'serverCreate')).toContain(
      'только владелец',
    );
  });

  test('serverTest 409 → отпечаток не совпал', () => {
    expect(
      errorText(apiError(409, 'host key fingerprint does not match'), 'serverTest'),
    ).toContain('не совпал');
  });

  test('serverTest 429 → троттлинг SSH-операций', () => {
    expect(errorText(apiError(429, 'ThrottlerException'), 'serverTest')).toContain(
      'SSH-операций',
    );
  });
});

describe('apiErrorCode', () => {
  test('код из envelope, null для прочего', () => {
    expect(
      apiErrorCode(
        apiError(424, 'x', { statusCode: 424, errorCode: 'AUTH_FAILED' }),
      ),
    ).toBe('AUTH_FAILED');
    expect(apiErrorCode(apiError(404, 'x'))).toBeNull();
    expect(apiErrorCode(new TypeError('fetch'))).toBeNull();
  });
});

describe('codeText', () => {
  test('известный код и null', () => {
    expect(codeText('DOCKER_MISSING')).toBe('Docker не установлен на сервере.');
    expect(codeText('NOPE')).toBeNull();
    expect(codeText(null)).toBeNull();
  });
});
