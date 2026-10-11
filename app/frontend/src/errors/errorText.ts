import { ApiError } from '../api/client';

export type ErrorContext =
  | 'login'
  | 'session'
  | 'invite'
  | 'accept'
  | 'serverCreate'
  | 'serverTest'
  | 'serverSearch'
  | 'projectCreate'
  | 'deployConfig'
  | 'deploy'
  | 'passwordChange'
  | 'generic';

/**
 * Словарь кодов бэкенда (SshErrorCode + DeployErrorCode).
 * Тексты — для людей; исходный код остаётся в EN-сообщении и в логах.
 */
const CODE_TEXTS: Record<string, string> = {
  AUTH_FAILED: 'Сервер отклонил аутентификацию: проверьте имя пользователя и ключ/пароль.',
  TIMEOUT: 'Превышено время ожидания ответа от сервера.',
  REFUSED: 'Соединение отклонено: порт SSH закрыт или сервис не слушает.',
  DNS: 'Не удалось разрешить имя хоста.',
  HOST_KEY: 'Ошибка проверки ключа хоста.',
  NETWORK: 'Сеть недоступна: хост не отвечает.',
  HOST_UNREACHABLE: 'Хост недоступен.',
  HOST_KEY_NOT_TRUSTED: 'Отпечаток ключа хоста не подтверждён.',
  HOST_KEY_MISMATCH: 'Отпечаток ключа хоста изменился — соединение прервано.',
  TARGET_BLOCKED: 'Адрес хоста запрещён политикой панели.',
  PORT_NOT_ALLOWED: 'Порт вне разрешённого списка панели.',
  RESOLUTION_FAILED: 'Не удалось определить адрес хоста.',
  DOCKER_MISSING: 'Docker не установлен на сервере.',
  DOCKER_PERMISSION_DENIED:
    'Нет прав на сокет Docker: пользователя нужно добавить в группу docker.',
  DOCKER_SOCKET_UNREACHABLE: 'Docker-демон не отвечает через сокет.',
  DOCKER_UNREACHABLE: 'Docker API недоступен на сервере.',
  SYSTEMD_MISSING: 'На сервере нет systemd — установка агента невозможна.',
  SUDO_REQUIRED: 'Для установки нужен sudo без пароля (NOPASSWD).',
  MANIFEST_INVALID: 'Манифест агента повреждён.',
  IDENTITY_MISMATCH: 'На сервере агент другого пространства или сервера.',
  AGENT_NOT_RUNNING: 'Агент не запущен.',
  AGENT_HEARTBEAT_STALE: 'Агент давно не выходил на связь.',
  AGENT_VERSION_MISMATCH: 'Версия агента не совпадает с версией панели.',
  AGENT_MANIFEST_MISSING: 'Файл манифеста агента отсутствует.',
  COMMAND_FAILED: 'Команда на сервере завершилась с ошибкой.',
  READ_FAILED: 'Не удалось прочитать состояние агента.',
  GIT_MISSING: 'git не установлен на сервере.',
  REF_NOT_FOUND: 'Ветка или тег не найдены в репозитории.',
  DOCKERFILE_MISSING: 'Dockerfile не найден по указанному пути.',
  SOURCE_FAILED: 'Не удалось получить исходники (git clone).',
  BUILD_FAILED: 'Сборка образа завершилась с ошибкой.',
  RUN_FAILED: 'Не удалось запустить контейнер.',
  SNAPSHOT_INVALID: 'Снимок конфигурации деплоя повреждён.',
  PANEL_RESTARTED: 'Деплой прерван перезапуском панели.',
  ACCESS_LOST: 'У инициатора пропал доступ к пространству.',
  SEARCH_UNAVAILABLE: 'Поиск временно недоступен — служба поиска не отвечает.',
};

export function codeText(code: string | null | undefined): string | null {
  return code ? (CODE_TEXTS[code] ?? null) : null;
}

/**
 * 401 в загрузке данных — забота слоя сессии (редирект на вход),
 * а не повод рисовать «Не удалось загрузить» в контенте.
 */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

function envelopeCode(err: ApiError): string | null {
  const payload = err.payload;
  if (typeof payload === 'object' && payload !== null && 'errorCode' in payload) {
    const code = (payload as { errorCode: unknown }).errorCode;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Код из envelope (например, SSH-код у 424/504) — для показа mono рядом с текстом. */
export function apiErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? envelopeCode(err) : null;
}

function envelopeMessage(err: ApiError): string | null {
  const payload = err.payload;
  if (typeof payload !== 'object' || payload === null || !('message' in payload)) {
    return null;
  }
  const message = (payload as { message: unknown }).message;
  if (typeof message === 'string' && message !== '') return message;
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string');
    if (parts.length > 0) return parts.join('; ');
  }
  return null;
}

const BY_STATUS: Record<ErrorContext, Partial<Record<number, string>>> = {
  login: {
    401: 'Неверный email или пароль.',
    429: 'Слишком много попыток входа. Подождите минуту.',
  },
  session: {
    401: 'Сессия истекла — войдите снова.',
  },
  invite: {
    403: 'Приглашать может только владелец пространства.',
    404: 'Пространство не найдено.',
    409: 'Этот адрес уже участвует в пространстве.',
  },
  accept: {
    403: 'Приглашение выдано на другой адрес.',
    404: 'Приглашение не найдено, истекло или отозвано.',
    409: 'Вы уже участник этого пространства.',
  },
  serverCreate: {
    403: 'Добавлять серверы может только владелец пространства.',
    404: 'Пространство не найдено.',
    409: 'Имя уже занято в этом пространстве, либо отпечаток ключа уже привязан к другому серверу.',
    429: 'Слишком много запросов. Подождите минуту.',
  },
  serverTest: {
    404: 'Сервер не найден.',
    409: 'Отпечаток ключа хоста не совпал с сохранённым — соединение остановлено.',
    429: 'Слишком много SSH-операций. Повторите через минуту.',
  },
  serverSearch: {
    400: 'Некорректный поисковый запрос: до 64 символов.',
  },
  projectCreate: {
    400: 'Проверьте поля: имя до 64 символов без emoji; репозиторий — публичный HTTPS без учётных данных.',
    403: 'Создавать проекты может только владелец пространства.',
    404: 'Пространство не найдено.',
    409: 'Имя проекта уже занято в этом пространстве.',
  },
  deployConfig: {
    400: 'Проверьте поля: ref — ветка или тег без .. ^ ~, Dockerfile — относительный путь внутри репозитория.',
    403: 'Добавлять конфиги деплоя может только владелец пространства.',
    404: 'Проект или сервер не найден.',
    409: 'Имя конфига занято в этом проекте, либо контейнер с таким именем уже используется на этом сервере.',
  },
  deploy: {
    403: 'Запускать деплой может только владелец пространства.',
    404: 'Проект или конфиг не найден.',
    409: 'Деплой этого конфига уже в очереди или выполняется.',
    429: 'Слишком много SSH-операций. Повторите через минуту.',
  },
  passwordChange: {
    401: 'Сессия истекла — войдите заново.',
    403: 'Неверный текущий пароль.',
    429: 'Слишком много попыток. Подождите минуту.',
  },
  generic: {
    403: 'Недостаточно прав для этого действия.',
    404: 'Объект не найден.',
    429: 'Слишком много запросов. Подождите минуту.',
  },
};

export function errorText(err: unknown, context: ErrorContext = 'generic'): string {
  if (!(err instanceof ApiError)) {
    return 'Нет соединения с сервером панели.';
  }

  // Зависимости (SSH/docker): код бэкенда осмысленнее статуса.
  if (err.status === 424 || err.status === 504) {
    const mapped = codeText(envelopeCode(err));
    if (mapped) return mapped;
  }

  const byStatus = BY_STATUS[context][err.status];
  if (byStatus) return byStatus;

  if (err.status >= 500) {
    return 'Ошибка панели. Попробуйте ещё раз.';
  }

  return envelopeMessage(err) ?? (err.message || `Ошибка ${err.status}`);
}
