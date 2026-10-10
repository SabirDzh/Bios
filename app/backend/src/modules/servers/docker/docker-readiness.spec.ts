import { classifyDialFailure } from './docker-readiness';

describe('classifyDialFailure', () => {
  test('нет бинарника docker → DOCKER_MISSING', () => {
    expect(classifyDialFailure('sh: docker: not found', 'exit 127')).toBe(
      'DOCKER_MISSING',
    );
    expect(
      classifyDialFailure('bash: docker: command not found', 'exit 127'),
    ).toBe('DOCKER_MISSING');
  });

  test('нет прав на сокет → DOCKER_PERMISSION_DENIED', () => {
    expect(
      classifyDialFailure(
        'permission denied while trying to connect to the Docker daemon socket',
        '',
      ),
    ).toBe('DOCKER_PERMISSION_DENIED');
  });

  test('демон молчит → DOCKER_SOCKET_UNREACHABLE', () => {
    expect(
      classifyDialFailure(
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
        'is the docker daemon running?',
      ),
    ).toBe('DOCKER_SOCKET_UNREACHABLE');
  });

  test('нераспознанный вывод → DOCKER_UNREACHABLE, а не «команда упала»', () => {
    expect(classifyDialFailure('docker: unknown dial-stdio flag', '')).toBe(
      'DOCKER_UNREACHABLE',
    );
    expect(classifyDialFailure('', '')).toBe('DOCKER_UNREACHABLE');
  });

  test('регистр и лишний текст не сбивают классификатор', () => {
    expect(
      classifyDialFailure('sh: DOCKER: NOT FOUND', 'warning: something'),
    ).toBe('DOCKER_MISSING');
  });
});
