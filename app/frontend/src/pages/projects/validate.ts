/**
 * Зеркало серверной валидации (project.types.ts, deploy-config DTO) на клиенте:
 * пользователь видит ошибку до запроса, сервер остаётся последней границей.
 * Regex-ы и запреты скопированы с бэкенда 1:1 — расхождение здесь означает
 * 400 из формы, которую клиент считал корректной.
 */

const NAME_RE = /^[\p{L}\p{N} _#-]{1,64}$/u;

const REPO_URL_RE =
  /^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?::(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5]))?(?:\/[A-Za-z0-9._~%-]{0,100}){1,8}$/;

const FORBIDDEN_HOSTS = new Set(['localhost', '0', '127', '::1']);
const PRIVATE_HOST_RE = /\.(local|internal|intranet|corp|lan|home|localdomain)$/;

const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^{}-]{0,99}$/;
const RELATIVE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const PORT_MAP_RE = /^(\d{1,5}):(\d{1,5})(?:\/(tcp|udp))?$/;

export function validateDisplayName(value: string): string | null {
  return NAME_RE.test(value.trim())
    ? null
    : 'Только буквы, цифры, пробел и - _ # (1–64 символа).';
}

export function validateRepoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 500) {
    return 'Адрес от 8 до 500 символов.';
  }
  if (!REPO_URL_RE.test(trimmed)) {
    return 'Публичный HTTPS-адрес вида https://github.com/org/repo — без учётных данных и пробелов.';
  }
  const host = new URL(trimmed).hostname;
  if (
    FORBIDDEN_HOSTS.has(host) ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    PRIVATE_HOST_RE.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    return 'Хост должен быть публичным доменом, а не локальным адресом.';
  }
  return null;
}

export function validateGitRef(value: string): string | null {
  const ref = value.trim();
  if (
    !GIT_REF_RE.test(ref) ||
    ref.includes('..') ||
    ref.includes('~') ||
    ref.includes('^') ||
    ref.includes('{')
  ) {
    return 'Ветка или тег: буквы, цифры, . _ / - без .. ~ ^ { (до 100 символов).';
  }
  return null;
}

export function validateDockerfile(value: string): string | null {
  const path = value.trim();
  if (!RELATIVE_FILE_RE.test(path) || path.includes('..')) {
    return 'Относительный путь внутри репозитория, без .. и ведущего / (до 120 символов).';
  }
  return null;
}

export function validateContainerName(value: string): string | null {
  return CONTAINER_NAME_RE.test(value.trim())
    ? null
    : 'Имя контейнера Docker: латиница, цифры, _ . - (до 64 символов).';
}

export interface PortsValidation {
  ports: string[];
  error: string | null;
}

/** Строки Textarea → массив маппингов; дубли host/proto — ошибка (как на бэкенде). */
export function validatePorts(raw: string): PortsValidation {
  const ports = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const seen = new Set<string>();
  for (const entry of ports) {
    const match = PORT_MAP_RE.exec(entry);
    if (!match) {
      return {
        ports,
        error: `«${entry}»: формат host:container или host:container/tcp (udp).`,
      };
    }
    const hostPort = Number(match[1]);
    const containerPort = Number(match[2]);
    if (
      hostPort < 1 ||
      hostPort > 65535 ||
      containerPort < 1 ||
      containerPort > 65535
    ) {
      return { ports, error: `«${entry}»: порты 1–65535.` };
    }
    const key = `${hostPort}/${match[3] ?? 'tcp'}`;
    if (seen.has(key)) {
      return { ports, error: `Хост-порт ${key} указан дважды.` };
    }
    seen.add(key);
  }
  return { ports, error: null };
}
