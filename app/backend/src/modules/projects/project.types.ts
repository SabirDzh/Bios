import { BadRequestException } from '@nestjs/common';

/**
 * Проект = публичный HTTPS-репозиторий (решение владельца: приватные репо не в
 * этом срезе, секрета в схеме нет). Whitelist закрывает три класса сразу:
 * credentials в authority, shell-метасимволы (URL уходит в `git clone` на хосте)
 * и адресные цели — хост не должен по команде панели ходить в свой link-local.
 *
 * Порт ограничен диапазоном 1–65535 БЕЗ ведущих нулей, и это не косметика:
 * прежний `\d{2,5}` пропускал `:99999`, после чего `new URL()` бросал TypeError,
 * и клиент получал 500 вместо 400 (замер: `URL THROWS: TypeError`).
 * С таким regex разбор URL больше не может упасть, поэтому try/catch тут был бы
 * мёртвым кодом.
 */
export const REPO_URL_RE =
  /^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?::(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5]))?(?:\/[A-Za-z0-9._~%-]{0,100}){1,8}$/;

/** Имена, которые regex пропускает, но публичными считать нельзя. */
const FORBIDDEN_HOSTS = new Set(['localhost', '0', '127', '::1']);
const PRIVATE_HOST_RE =
  /\.(local|internal|intranet|corp|lan|home|localdomain)$/;

export interface ProjectResponse {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeRepoUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new BadRequestException(
      'repoUrl is required and must be ≤ 500 characters',
    );
  }
  if (!REPO_URL_RE.test(trimmed)) {
    throw new BadRequestException(
      'repoUrl must be a public https://host/path without credentials, spaces or shell metacharacters',
    );
  }
  // Хост приводит к нижнему регистру сам WHATWG-парсер; путь остаётся тем, каким
  // его дал пользователь: для git-сервера `Group/MyRepo` и `group/myrepo` —
  // разные репозитории.
  const url = new URL(trimmed);
  const host = url.hostname;
  if (
    FORBIDDEN_HOSTS.has(host) ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    PRIVATE_HOST_RE.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new BadRequestException('repoUrl host must be a public domain name');
  }
  return `${url.origin}${url.pathname}`;
}

/** Используется DTO-валидатором и сервисом: нормализация одна, в одном месте. */
export function assertPublicHttpsRepoUrl(value: string): string {
  return normalizeRepoUrl(value);
}

/**
 * ref уходит в `git clone --branch`. Отклоняем всё, что git трактует иначе:
 * ведущий `-` (опция), `..`, `~`/`^` (ревизии), `@{` (reflog) — иначе `main^`
 * склонировал бы «не то», а не упал на границе.
 */
export const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^{}-]{0,99}$/;
/** Относительный путь внутри репозитория: без ведущего `/`, без `..`, без метасимволов. */
export const RELATIVE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
/** Правила имён контейнера docker: [a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}. */
export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
export const PORT_MAP_RE = /^(\d{1,5}):(\d{1,5})(?:\/(tcp|udp))?$/;

function reject(value: string, message: string): never {
  throw new BadRequestException(`${message}: "${value}"`);
}

export function assertGitRef(value: string): string {
  const ref = value.trim();
  if (
    !GIT_REF_RE.test(ref) ||
    ref.includes('..') ||
    ref.includes('~') ||
    ref.includes('^') ||
    ref.includes('{')
  ) {
    reject(ref, 'ref must be a plain branch or tag name');
  }
  return ref;
}

export function assertRelativeFilePath(value: string): string {
  const path = value.trim();
  if (!RELATIVE_FILE_RE.test(path) || path.includes('..')) {
    reject(path, 'dockerfile must be a relative path inside the repository');
  }
  return path;
}

export function assertContainerName(value: string): string {
  const name = value.trim();
  if (!CONTAINER_NAME_RE.test(name)) {
    reject(name, 'containerName must be a docker container name');
  }
  return name;
}

/**
 * Хост-порты обязаны быть уникальными: docker вернул бы ошибку позже и без
 * внятного текста, а пользователь считал бы это сбоем панели. Ключ сравнения —
 * НОРМАЛИЗОВАННЫЙ номер и протокол: `08080:80` и `8080:80` — один и тот же
 * занятый порт, а `8080:80/tcp` и `8080:80/udp` — разные, и docker их разрешает
 * одновременно.
 */
export function assertPortMappings(value: string[] | undefined): string[] {
  const ports = (value ?? []).map((entry) => entry.trim());
  const seen = new Set<string>();
  for (const entry of ports) {
    const match = PORT_MAP_RE.exec(entry);
    if (!match) {
      reject(
        entry,
        'each port mapping must look like host:container or host:container/tcp',
      );
    }
    const hostPort = Number(match[1]);
    const containerPort = Number(match[2]);
    if (
      hostPort < 1 ||
      hostPort > 65535 ||
      containerPort < 1 ||
      containerPort > 65535
    ) {
      reject(entry, 'port numbers must be 1-65535');
    }
    const proto = match[3] ?? 'tcp';
    const key = `${hostPort}/${proto}`;
    if (seen.has(key)) {
      reject(entry, `host port ${key} is mapped twice`);
    }
    seen.add(key);
  }
  return ports;
}

export interface DeployConfigResponse {
  id: string;
  projectId: string;
  serverId: string;
  name: string;
  /** В этом срезе исполняется только GIT_PULL; тип отражает границу DTO. */
  method: 'GIT_PULL';
  ref: string;
  dockerfile: string;
  containerName: string;
  ports: string[];
  createdAt: Date;
  updatedAt: Date;
}
