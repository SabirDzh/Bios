import { expect, test } from 'vitest';
import {
  validateContainerName,
  validateDockerfile,
  validateDisplayName,
  validateGitRef,
  validatePorts,
  validateRepoUrl,
} from './validate';

test('имя: буквы любых алфавитов, цифры, пробел и - _ #', () => {
  expect(validateDisplayName('Мой проект #1')).toBeNull();
  expect(validateDisplayName('web-api')).toBeNull();
  expect(validateDisplayName('')).not.toBeNull();
  expect(validateDisplayName('a'.repeat(65))).not.toBeNull();
  expect(validateDisplayName('bad/slash')).not.toBeNull();
  expect(validateDisplayName('smile 😀')).not.toBeNull();
});

test('repoUrl: только публичный HTTPS без учётных данных', () => {
  expect(validateRepoUrl('https://github.com/acme/app')).toBeNull();
  expect(validateRepoUrl('https://github.com/acme/app/')).toBeNull();
  expect(validateRepoUrl('  https://gitlab.com/g/r.git  ')).toBeNull();

  expect(validateRepoUrl('http://github.com/acme/app')).not.toBeNull();
  expect(validateRepoUrl('https://user:pass@github.com/acme/app')).not.toBeNull();
  expect(validateRepoUrl('git@github.com:acme/app.git')).not.toBeNull();
  expect(validateRepoUrl('https://localhost/acme/app')).not.toBeNull();
  expect(validateRepoUrl('https://10.0.0.5/acme/app')).not.toBeNull();
  expect(validateRepoUrl('https://192.168.1.10/acme/app')).not.toBeNull();
  expect(validateRepoUrl('https://169.254.169.254/latest')).not.toBeNull();
  expect(validateRepoUrl('https://api.internal/acme/app')).not.toBeNull();
  expect(validateRepoUrl('https://github.com:99999/acme/app')).not.toBeNull();
  // Без пути — не репозиторий.
  expect(validateRepoUrl('https://github.com')).not.toBeNull();
});

test('ref: ветки и теги без ревизионных метасимволов', () => {
  expect(validateGitRef('main')).toBeNull();
  expect(validateGitRef('release/v1.2.3')).toBeNull();
  expect(validateGitRef('v1.0.0-rc.1')).toBeNull();

  expect(validateGitRef('-main')).not.toBeNull();
  expect(validateGitRef('main^')).not.toBeNull();
  expect(validateGitRef('main~1')).not.toBeNull();
  expect(validateGitRef('a..b')).not.toBeNull();
  expect(validateGitRef('main@{1}')).not.toBeNull();
  expect(validateGitRef('')).not.toBeNull();
});

test('dockerfile: относительный путь без .. ', () => {
  expect(validateDockerfile('Dockerfile')).toBeNull();
  expect(validateDockerfile('docker/Dockerfile.prod')).toBeNull();

  expect(validateDockerfile('/etc/Dockerfile')).not.toBeNull();
  expect(validateDockerfile('../Dockerfile')).not.toBeNull();
  expect(validateDockerfile('docker/../../x')).not.toBeNull();
});

test('containerName: правила docker', () => {
  expect(validateContainerName('app-1')).toBeNull();
  expect(validateContainerName('app_1.blue')).toBeNull();

  expect(validateContainerName('-app')).not.toBeNull();
  expect(validateContainerName('app:1')).not.toBeNull();
  expect(validateContainerName('a'.repeat(65))).not.toBeNull();
});

test('порты: формат, диапазон, уникальность host/proto с нормализацией нулей', () => {
  expect(validatePorts('8080:80\n8443:443/tcp')).toEqual({
    ports: ['8080:80', '8443:443/tcp'],
    error: null,
  });
  // Пустые строки отбрасываются.
  expect(validatePorts('\n8080:80\n\n')).toEqual({ ports: ['8080:80'], error: null });

  expect(validatePorts('8080').error).toContain('формат');
  expect(validatePorts('0:80').error).toContain('1–65535');
  expect(validatePorts('70000:80').error).toContain('1–65535');
  expect(validatePorts('8080:80/sctp').error).toContain('формат');
  // `08080` и `8080` — один и тот же занятый порт.
  expect(validatePorts('08080:80\n8080:81').error).toContain('8080/tcp');
  // tcp и udp на одном порту — разные маппинги.
  expect(validatePorts('8080:80/tcp\n8080:80/udp').error).toBeNull();
});
