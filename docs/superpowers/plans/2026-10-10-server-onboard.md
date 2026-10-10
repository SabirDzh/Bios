# Server onboard (MVP часть 3) Implementation Plan — рев. 2 (по ревью)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 6 эндпоинтов раздела «3. Server onboard — aha-moment»: добавить сервер с SSH-креденшелами, проверить подключение, установить агента и прочитать его статус — так, чтобы `online` означал проверяемый факт, а не обещание.

**Architecture:** Prisma-модель `Server` (креденшелы — AES-256-GCM с идентификатором ключа; SSH-канал + fingerprint хоста). Удалённый доступ — SSH из панели через шов `SshRunner` (`NodeSshRunner` в проде, `FakeSshRunner` в тестах, плюс реальные тесты адаптера против in-process `ssh2.Server`). Перед подключением адрес проходит политику сетевых целей; перед аутентификацией проверяется host key (TOFU с явным подтверждением отпечатка). «Агент» — версионированный artifact на хосте (`/opt/bios-agent` + systemd-unit с heartbeat-петлёй); установка считается успешной только по подтверждённому `ACTIVE` + совпадению версии и идентификаторов, а не по нулевому коду shell-скрипта.

**Tech Stack:** NestJS 11, Prisma 6.19.3, PostgreSQL 18, class-validator 0.15.1, node-ssh 13.2.1 (поверх ssh2 1.14), `node:crypto`, `node:dns`, jest + ts-jest (живой PG), `sh`-песочница для тестов генератора команд.

**Spec:** `docs/mvp-scope.md` (раздел «3. Server onboard — aha-moment»), роуты — `API.md:32-42`. Вне скоупа (P1): `PATCH/DELETE server`, `agent/upgrade`, `DELETE agent`, `connections`.
**Review:** `Ревью Server Onboard — MVP, часть 3` (13 замечаний) — развёрнутый разбор каждого пункта и принятые решения в разделе «Ответ на ревью» ниже. Реализация не начинается, пока пункты ревью не отражены в задачах (см. соответствие в той же таблице).

## Global Constraints

- Node 26.7.0, npm 11.19.0; ветка `dev` (не `main`); `npm run build` зелёный после каждой задачи; коммит в конце каждой задачи; **не пушим**.
- В рабочем дереве есть чужие незакоммиченные правки (`src/modules/auth/auth-cookies.ts`, `auth.controller.ts`, `decorators/refresh-token.decorator.ts`, `guards/jwt.strategy.ts`, `src/modules/users/users.controller.ts`, `src/modules/auth/auth-cookies.spec.ts`, а также весь `docs/`). Их НЕ трогать, НЕ откатывать, НЕ добавлять в свои коммиты: `git add` только своих путей.
- БД (проверено `psql -tAc`): `bios`, `bios_test`, `bios_test_maintenance`, `bios_test_workspaces`; добавить `bios_test_servers`. URL `postgresql://sabir@localhost:5432/<db>?schema=public`.
- id — `String @id @default(uuid(7))`; все `DateTime` — `@db.Timestamptz(3)`.
- `process.env` читает ТОЛЬКО `src/config/app.config.ts`. Новые настройки — только через `AppConfig`.
- Зависимости: `node-ssh@^13.2.1` + `ssh2@^1.17.0` (runtime) и `@types/ssh2` (dev). `ssh2` — прямой dependency, а не чужой транзитив: на нём держатся `utils.parseKey` (структурная проверка приватного ключа в Task 8) и `Server` (in-process фикстура тестов адаптера); полагаться на чужой transitive — значит получить тихий дрейф версии. Больше ничего. `shell-escape` не ставим — своё `shq()` с тестом и shell-песочницей.
- **Host key обязательен.** `hostVerifier` НЕ задавать нельзя: по документации ssh2 при отсутствии верификатора ключ хоста принимается автоматически. Проверка идёт до отправки креденшелов (KEX предшествует user-auth), отказ верификатора обрывает handshake. Запрещено «пинить» увиденный отпечаток молча: он пишется в строку только после того, как клиент прислал совпадающий `trustHostKey`.
- **Ловушка node-ssh, обязательна к учёту:** при возврате `false` из `hostVerifier` node-ssh реджектится с `SSHError('No response from server', 'ETIMEDOUT')`. Адаптер обязан сначала посмотреть, что верификатор сам зафиксировал ключ, и ONLY тогда выбросить `HOST_KEY_NOT_TRUSTED`/`HOST_KEY_MISMATCH`; иначе `classifySshError` схлопнет это в `TIMEOUT`.
- **Сетевая цель проверяется до соединения.** Хост резолвится явно (`node:dns`, `all: true, verbatim: true`), каждый адрес проверяется политикой, соединяемся с проверенным IP, а не с именем (закрывает DNS rebinding между проверкой и подключением). Приватные диапазоны разрешены — это основной сценарий продукта; запрещены link-local/metadata, unspecified, multicast, loopback (кроме явного флага dev/smoke) и порты вне allowlist.
- **Docker: не выдавать отказ доступа за отсутствие.** Префлайт различает `command -v docker` (нет CLI → `DOCKER_MISSING`), `permission denied` на сокете (`DOCKER_PERMISSION_DENIED`) и недоступный демон (`DOCKER_SOCKET_UNREACHABLE`). Политика MVP: SSH-пользователь обязан иметь **прямой** доступ к Docker; `sudo` используется только для шагов установки юнита, но не для доступа к Docker.
- **Установленный агент ≠ ноль кода возврата.** `install` даёт `INSTALLED` только при `status === 'ACTIVE'` **и** `version === cfg.ssh.agentVersion` **и** совпадении `workspaceId`/`serverId` в манифесте. Иначе — `424` с кодом из таблицы и сохранённой диагностикой.
- **Транспорт и персистентность разделены.** `try/catch` обхватывает только SSH-вызов. Ошибка записи в PostgreSQL — это `500`, а не `reachable: false`; запрещён `catch`, внутри которого и SSH, и `update`.
- **Разные состояния на разных осях:** `Server.status` = доступность хоста по SSH (`PENDING`/`ONLINE`/`OFFLINE`); `dockerVersion`/`lastAgentStatus`/`lastAgentErrorCode` = работоспособность Docker и агента. `AGENT_FAILED` не делает хост `OFFLINE`, `ONLINE` не делает агента установленным.
- Креденшелы: плейнтекст не в БД, не в ответах, не в тексте удалённых команд, не в логах. Cipher `v1.<kid>.<iv>.<tag>.<data>`; `kid` нужен, чтобы смена `SERVER_CRYPTO_KEY` не делала данные нечитаемыми.
- Все интерполируемые в удалённую команду значения проходят `shq()`. Пути агента параметризуемы (дефолт — прод-константы), поэтому генератор покрыт тестом на реальном `sh`, а не только сравнением строк.
- `tryKeyboard` НЕ включаем (MVP: пароль + незашифрованный PEM; обработчика keyboard-interactive нет). Passphrase-PEM отклоняем.
- Стаб `DockerService.findContainers` (`return []`) — скоуп части 4: не трогать. Остальные стабы (`compose/git/projects/deployments`) — тоже.
- Маппинг HTTP-ошибок (единый для модуля):
  - нет membership **или** сервер из другого воркспейса → `404` неотличимо;
  - `create`/`install` без `OWNER` → `403`; `list`/`get`/`test`/`agent` — любой member;
  - дубль `name` (`P2002`) → `409`; невалидный PEM приватного ключа или не-`authType` креденшел → `400`;
  - `POST .../test`: сетевой/аутентификационный сбой и «host key не подтверждён» → `200` с `reachable: false`/`trustRequired: true` (это результат проверки, не ошибка запроса); подтверждение с несовпавшим отпечатком → `409`;
  - `install`/`GET agent`: без подтверждённого host key, при несовпадении отпечатка, при недоступном хосте, при блокировке политики, при отказе Docker/systemd/sudo и при неподтверждённом состоянии агента → `424 FailedDependencyException({ errorCode, message })`;
  - **`FailedDependencyException` в Nest 11 НЕТ** (проверено: `require('@nestjs/common')` не экспортирует его; 424 среди готовых классов тоже нет). Класс свой, тонкий: `src/common/http/failed-dependency.exception.ts` extends `HttpException` и фиксирует форму тела `{ statusCode: 424, errorCode, message }`. Все snippets ниже, где он импортируется из `@nestjs/common`, читать как импорт отсюда.
  - `AllExceptionsFilter` обязан пропускать `errorCode` наружу: по умолчанию envelope собирает только `{statusCode, message, path, timestamp}` и теряет машинный код — добавлена одна строка проброса + тест в `all-exceptions.filter.spec.ts`.
  - ошибка расшифровки/персистентности → `500`.
- Ответы — явные публичные шейпы (`ServerResponse`, `ServerTestResponse`, `AgentResponse`, `AgentInstallResponse`); Prisma-строки наружу не возвращать.
- Rate limit: `test`/`install`/`GET agent` — `@ThrottleProfile('sshOps')` (6/мин); `create/list/get` — глобальный 120/мин.
- SSH-соединение — одно на команду (без пула), `dispose()` в `finally`.
- Тесты: у spec-файла своя БД (`bios_test_servers`), `PrismaService` — только в `beforeAll`, `process.env.DATABASE_URL` — первая строка файла. `afterEach` чистит в порядке FK: `Server → WorkspaceInvitation → WorkspaceMember → Workspace → Token → RefreshSession → User`.
- Удалённые команды в интеграционных тестах не исполняются: поведение — через `FakeSshRunner`; транспорт — через `ssh2.Server` в тесте адаптера (Task 6); генератор команд — через `sh`-песочницу (Task 7).
- Сообщения валидации и ошибок — английский, строчная буква в начале.
- Prettier + eslint по touched-файлам после каждой задачи.

## Response to Review

| # | Пункт ревью | Вердикт | Что сделано в этом плане |
|---|---|---|---|
| 1 | host key не проверяется, это не TOFU | **Принято, замечание точнее, чем в исходном плане** | Реальный TOFU: `hostVerifier` + `Server.hostKeyFingerprint`, probe без отправки креденшелов, явное подтверждение `trustHostKey`, `HOST_KEY_MISMATCH` → 424. Task 1/6/9 |
| 2 | нет политики сетевых целей (SSRF) | **Принято** | Новый слой `network-policy.ts`: DNS-before-connect, блок link-local/metadata/unspecified/multicast, allowlist портов, `allowLoopback` только по флагу. Приватные сети разрешены (оговорка ревью учтена). Task 2/5 |
| 3 | XOR противоречит `@ValidateIf` | **Принято, проверено эмпирически** | Прогон class-validator 0.15.1: при `false`-предикате свойство пропускается ЦЕЛИКОМ, кастомный констрейнт не запускается; кейс «ни одного креденшела» давал `[]` (то есть прошёл бы валидацию). Заменено на явный `authType`-дискриминатор + всегда живой констрейнт на обязательном поле. Task 4 |
| 4 | install может вернуть успех при `FAILED`/`STALE` | **Принято** | У успех = `ACTIVE` + версия + идентификаторы; иначе 424 с кодом и сохранённой диагностикой. Task 10 |
| 5 | Docker проверяется от пользователя без прав | **Принято** | Разделение `DOCKER_MISSING`/`DOCKER_PERMISSION_DENIED`/`DOCKER_SOCKET_UNREACHABLE`, политика «прямой доступ», фикстура smoke работает под root (иначе дымовой тест падал бы на доступе, а не на systemd). Task 6/7/9/11 |
| 6 | `GET agent` путает отсутствие systemd/битый манифест с `NOT_INSTALLED` | **Принято** | Протокол чтения печатает `SD`/`MF`/`JSON`/`UNIT`/`HB`/`NOW`; таблица состояний различает `NOT_INSTALLED` и `FAILED` с причиной (`SYSTEMD_MISSING`, `MANIFEST_INVALID`, `IDENTITY_MISMATCH`, `AGENT_NOT_RUNNING`). `readAgent` проверяет код и полноту ключей. Task 7/10 |
| 7 | ошибки PostgreSQL маскируются под SSH | **Принято** | Узкий `try/catch` только вокруг `ssh.exec`; ошибка записи → 500. Task 9 |
| 8 | нет ротации ключа шифрования | **Принято в объёме MVP** | `kid` в формате cipher + `SERVER_CRYPTO_OLD_KEYS` (decrypt-only) + перевёртка активного ключа при успешной расшифровке + тест ротации. Полный внешний tool-релоадер не нужен: production-данных ещё нет |
| 8b | PEM валидируется только маркерами, фикстура `AAAA` — не ключ | **Принято** | `createPrivateKey()` из `node:crypto` как проверка структуры при создании; тестовая фикстура — реальный сгенерированный PEM |
| 9 | тест экранирования противоречив | **Принято, проверено** | Вторая ассерция (`toContain("serverId":"x'$(…)")`) падала бы корректно: `shq` вставляет `'\''`, разрывая подстроку. Заменено на точную escaped-строку + исполнение сгенерированного скрипта в `sh`-песочнице с проверкой «вредоносное выражение не выполнилось» |
| 10 | `tryKeyboard` без обработчика | **Принято** | Убран. `passphrase` не поддерживается (PEM с паролем отклоняется) |
| 11 | `ECONNRESET` → `TIMEOUT`; мало тестов адаптера | **Принято** | `ECONNRESET` → `NETWORK`; добавлены изолированные тесты `NodeSshRunner` против in-process `ssh2.Server`: зависание рукопожатия, зависание команды, отказ аутентификации, проброс кода/stderr, host-key probe/mismatch, закрытие соединения |
| 12 | smoke: build в фоне, readiness не гарантирован | **Принято** | `npm run build` foreground; `node dist/main &` + PID; ожидание через `GET /api/v1/health`; остановка по PID, не `pkill -f` |
| 13 | smoke ожидает `SYSTEMD_MISSING`, но раньше споткнётся о Docker | **Принято** | Контейнер работает под root (сокет доступен) → префлайт Docker проходит, отказ именно systemd |

Пункты, по которым я спорю с ревью: возражений нет — все тринадцать приняты; два (3 и 9) оказались строже, чем я сам оценил в первой версии, и подтверждены прогоном кода.

## Review Focus (что смотреть на ревью каждой задачи)

1. **Host key.** Первый `test` на новый сервер не отправляет креденшелы (проверка до аутентификации), `trustHostKey` обязан совпасть с увиденным отпечатком, молчаливое самозакрепление запрещено, несовпадение — 424 + `OFFLINE` (Task 9).
2. **Сетевая цель.** `169.254.169.254`, `127.0.0.1` без флага, `[::1]`, `224.0.0.1`, `0.0.0.0` и порт вне allowlist → отказ ДО соединения; приватные диапазоны → разрешены; соединяемся по проверенному IP (Task 5).
3. **Валидация креденшелов.** Все пять кейсов (`ни одного`/`оба`/`только пароль`/`только ключ`/`ключ не по authType`) дают ожидаемый результат, и ни один не полагается на «магию» `@ValidateIf` (Task 4 — там же эмпирически ожидаемые сообщения).
4. **Персистентность ≠ транспорт.** Тест, в котором `update` падает, обязан дать 500, а не `reachable: false` (Task 9).
5. **Строгий успех установки.** `ACTIVE` + версия + идентификаторы; сценарии `FAILED`/`STALE`/`MANIFEST_INVALID`/`IDENTITY_MISMATCH` → 424 с соответствующим кодом, при этом диагностика сохранена, `agentInstalledAt` не выставлен (Task 10).
6. **Экранирование исполняемо, а не похоже.** Shell-песочница доказывает, что payload с `'$(touch …)'` попадает в файл литералом и не исполняется (Task 7).

---

## File Structure

- Modify: `app/backend/prisma/schema.prisma` — `Server` (+ `hostKeyFingerprint`, `lastAgentStatus`, `lastAgentErrorCode`), enum `ServerStatus`, enum `ServerAuthType`, enum `AgentReportStatus`.
- Modify: `app/backend/src/config/app.config.ts`, `src/common/throttle/throttle-options.factory.ts` — `ssh`, `crypto`, профиль `sshOps`.
- Test: `src/config/app.config.spec.ts`, `src/common/throttle/throttle-profiles.spec.ts`.
- Create: `src/modules/servers/credentials/credential-crypto.service.ts` (+ spec) — AES-256-GCM с `kid`, old keys, `needsRewrap`.
- Create: `src/modules/servers/dto/create-server.dto.ts`, `dto/server-ids.dto.ts`, `dto/test-server.dto.ts`, `dto/dto.spec.ts`.
- Create: `src/common/validators/credential-matches-auth-type.validator.ts` — всегда живой констрейнт над `authType`.
- Create: `src/modules/servers/ssh/network-policy.ts` (+ `network-policy.spec.ts`) — `resolveTarget`, `assertAddressAllowed`, чистый `ipCategory`.
- Create: `src/modules/servers/ssh/ssh-runner.ts`, `ssh/classify-ssh-error.ts` (+ spec), `ssh/node-ssh.runner.ts`, `ssh/fake-ssh.runner.ts`.
- Test: `src/modules/servers/ssh/node-ssh.runner.spec.ts` + `ssh/testing/ssh-server-fixture.ts` — реальный транспорт против `ssh2.Server`.
- Create: `src/modules/servers/agent/shell-quote.ts`, `agent/agent-script.ts` (+ `agent-script.spec.ts`, `agent-script.sandbox.spec.ts`).
- Modify: `src/modules/workspaces/workspaces.service.ts` — публичный `requireMembership` (+ тесты в `workspaces.spec.ts`).
- Create: `src/modules/servers/servers.service.ts`, `src/modules/servers/agent.service.ts`.
- Modify: `src/modules/servers/servers.controller.ts`, `servers.module.ts`.
- Test: `src/modules/servers/servers.spec.ts` (БД `bios_test_servers`; вложенные `describe` для CRUD/test/agent).
- Create: `app/backend/test/servers.e2e-spec.ts`.
- Modify: `.env.template`, `docker-compose.yml` (корень репо).

## Interfaces

```ts
// ssh/ssh-runner.ts
export type SshErrorCode =
  // транспорт
  | 'AUTH_FAILED' | 'TIMEOUT' | 'REFUSED' | 'DNS' | 'HOST_KEY' | 'NETWORK'
  // host key (TOFU)
  | 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH'
  // сетевая политика
  | 'TARGET_BLOCKED' | 'PORT_NOT_ALLOWED' | 'RESOLUTION_FAILED'
  // docker на хосте
  | 'DOCKER_MISSING' | 'DOCKER_PERMISSION_DENIED' | 'DOCKER_SOCKET_UNREACHABLE'
  // агент
  | 'SYSTEMD_MISSING' | 'SUDO_REQUIRED' | 'MANIFEST_INVALID' | 'IDENTITY_MISMATCH'
  | 'AGENT_NOT_RUNNING' | 'AGENT_HEARTBEAT_STALE' | 'AGENT_VERSION_MISMATCH'
  | 'AGENT_MANIFEST_MISSING'
  // прочее
  | 'COMMAND_FAILED' | 'READ_FAILED';

export class SshFailure extends Error {
  constructor(
    readonly code: SshErrorCode,
    message: string,
    readonly observedHostKeyFingerprint?: string,
  );   // name === 'SshFailure'
}

export interface SshSession {
  host: string;                     // имя из DTO — только для логов/ответов
  address: string;                  // проверенный политикой IP: именно на него идём
  port: number;
  username: string;
  authType: ServerAuthType;
  secret: string;                   // пароль или PEM; наружу никогда
  /** Принятый отпечаток. null = режим probe: проверяем хост, креденшелы НЕ отправляем. */
  expectedHostKeyFingerprint: string | null;
}
export interface SshExecResult { stdout: string; stderr: string; code: number | null }
export interface SshRunner {
  exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult>;
}
export const SSH_RUNNER: symbol;
export function hostKeyFingerprint(rawKey: Buffer): string;  // 'SHA256:' + base64(sha256(blob))

// ssh/network-policy.ts
export type IpCategory =
  | 'loopback' | 'linkLocal' | 'unspecified' | 'multicast' | 'private'
  | 'public' | 'other';
export function ipCategory(ip: string): IpCategory;
export function parseHostLiteral(host: string): string | null;
export interface NetworkPolicy { allowedPorts: number[]; allowLoopback: boolean }
export type Resolver = (host: string) => Promise<string[]>;
export function resolveTarget(
  host: string, port: number, policy: NetworkPolicy, resolve?: Resolver,
): Promise<{ address: string }>;   // бросает SshFailure('TARGET_BLOCKED'|'PORT_NOT_ALLOWED'|'RESOLUTION_FAILED')

// agent/shell-quote.ts
export function shq(value: string): string;
export function priv(command: string, root: boolean): string;

// agent/agent-script.ts
export interface AgentPaths { dir: string; unitPath: string; manifestPath: string; heartbeatPath: string; scriptPath: string }
export const PROD_AGENT_PATHS: AgentPaths;                     // /opt/bios-agent + /etc/systemd/system/bios-agent.service
export const AGENT_UNIT = 'bios-agent.service';
export type AgentUnitState = 'active' | 'inactive' | 'failed' | 'no-unit' | 'no-systemd' | 'unknown';
export interface AgentRawState {
  systemd: 'ok' | 'missing' | 'unreadable';
  manifestFile: 'present' | 'absent' | 'unreadable';
  manifest: AgentManifest | null;
  manifestParseError: boolean;
  unit: AgentUnitState;
  heartbeatSec: number | null;
  nowSec: number | null;
}
export type AgentStatus = 'NOT_INSTALLED' | 'FAILED' | 'STALE' | 'ACTIVE';
export function buildDockerVersionCommand(): string;
export function buildAgentReadCommand(paths?: AgentPaths): string;
export function buildInstallScript(i: {
  workspaceId: string; serverId: string; version: string; root: boolean; paths?: AgentPaths;
}): string;
export function parseAgentState(stdout: string): AgentRawState;   // protocol error → все поля unreadable
export function agentStatusOf(
  s: AgentRawState,
  staleSec: number,
  expected: { workspaceId: string; serverId: string },
): { status: AgentStatus; errorCode: SshErrorCode | null };

// credentials/credential-crypto.service.ts
@Injectable() export class CredentialCryptoService {
  constructor(@Inject(APP_CONFIG) app: AppConfig);   // crypto.activeKey {id,key}, crypto.oldKeys Map<id,Buffer>
  encrypt(plaintext: string): string;               // 'v1.<kid>.<iv>.<tag>.<data>'
  decrypt(cipher: string): string;                  // Error при чужом/неизвестном kid и подмене
  needsRewrap(cipher: string): boolean;             // kid !== activeKey.id
}

// config/app.config.ts (добавляется)
export interface SshCfg {
  connectTimeoutMs: number; commandTimeoutMs: number; installTimeoutMs: number;
  agentVersion: string; heartbeatStaleSec: number;
  allowedPorts: number[]; allowLoopback: boolean;
}
export interface CryptoCfg {
  activeKey: { id: string; key: Buffer };
  oldKeys: Map<string, Buffer>;
  ephemeralServerKey: boolean;
}
export type ThrottleProfileName = 'authStrict' | 'recovery' | 'invite' | 'sshOps';

// workspaces.service.ts
requireMembership(userId: string, workspaceId: string, roles?: WorkspaceRole[]): Promise<WorkspaceRole>;

// servers.service.ts
create(userId, workspaceId, dto: CreateServerDto): Promise<ServerResponse>;
findAll(userId, workspaceId): Promise<ServerResponse[]>;
findOne(userId, workspaceId, serverId): Promise<ServerResponse>;
testConnection(userId, workspaceId, serverId, dto: TestServerDto): Promise<ServerTestResponse>;
loadForSsh(userId, workspaceId, serverId, roles, purpose: 'probe' | 'authenticated'): Promise<{ server: Server; session: SshSession }>;
export const MEMBER_ROLES: WorkspaceRole[]; export const OWNER_ONLY_ROLES: WorkspaceRole[];

// agent.service.ts
install(userId, workspaceId, serverId): Promise<AgentInstallResponse>;   // OWNER
status(userId, workspaceId, serverId): Promise<AgentResponse>;           // OWNER|MEMBER

// Шейпы ответов
// ServerResponse { id, workspaceId, name, host, port, sshUsername, authType, status,
//                  hostKeyFingerprint, dockerVersion, agentVersion, agentInstalledAt,
//                  lastAgentStatus, lastAgentErrorCode, lastCheckedAt, createdAt, updatedAt }
// ServerTestResponse { serverId, reachable, trustRequired, status, latencyMs, dockerVersion,
//                      dockerErrorCode, errorCode, hostKeyFingerprint, checkedAt }
// AgentResponse { serverId, status, version, installedAt, lastHeartbeatAt, dockerVersion, errorCode, checkedAt }
// AgentInstallResponse { serverId, outcome: 'INSTALLED' | 'ALREADY_ACTIVE', agent: AgentResponse }
```

### Таблица состояний агента (реализуется в `agentStatusOf`, Task 7)

| `systemd` | `manifestFile` | `JSON` разобран | `unit` | heartbeat | Ожидаемый `status` | `errorCode` |
|---|---|---|---|---|---|---|
| missing | absent | — | no-systemd | — | `NOT_INSTALLED` | `null` |
| ok | absent | — | `active` | — | `FAILED` | `AGENT_MANIFEST_MISSING` |
| ok | absent | — | inactive/failed/no-unit | — | `NOT_INSTALLED` | `null` |
| ok/missing | present | да (свой) | `active` | свежий | `ACTIVE` | `null` |
| ok | present | да (свой) | `active` | протух/нет | `STALE` | `AGENT_HEARTBEAT_STALE` |
| ok | present | да (свой) | ≠ active | — | `FAILED` | `AGENT_NOT_RUNNING` |
| ok | present | нет | любой | — | `FAILED` | `MANIFEST_INVALID` |
| ok | present | да (чужой ws/server) | любой | — | `FAILED` | `IDENTITY_MISMATCH` |
| missing | present | да (свой) | любой | — | `FAILED` | `SYSTEMD_MISSING` |
| unreadable | — | — | — | — | `FAILED` | `READ_FAILED` |

### Таблица удалённых ошибок → HTTP (Task 9/10)

| Условие | `test` | `install` | `GET agent` |
|---|---|---|---|
| нет принятого host key | `200 trustRequired:true` + fingerprint в ответе и `pending` не пишется | `424 HOST_KEY_NOT_TRUSTED` | `424 HOST_KEY_NOT_TRUSTED` |
| отпечаток не совпал с пином | `424`+`OFFLINE` | `424 HOST_KEY_MISMATCH` | `424 HOST_KEY_MISMATCH` |
| цель заблокирована политикой | `200 errorCode:TARGET_BLOCKED` | `424 TARGET_BLOCKED` | `424 TARGET_BLOCKED` |
| хост молчит/рефьюзит | `200 reachable:false, OFFLINE` | `424` + `OFFLINE` | `424` + `OFFLINE` |
| docker нет / отказ доступа / сокет молчит | `200 reachable:true` + `dockerErrorCode` | `424` с тем же кодом | — (не читается) |
| скрипт ставил, но агент не `ACTIVE` | — | `424` по таблице состояний, `lastAgentStatus` сохранён | `200` + статус |
| упала запись в БД | `500` | `500` | `500` |

Роуты (`@Controller('workspaces/:workspaceId/servers')`, глобальный префикс `api/v1`):

| # | Метод | Путь | Успех | Ошибки |
|---|---|---|---|---|
| 1 | POST | `…/servers` | 201 `ServerResponse` (`PENDING`, пина нет) | 400, 401, 403, 404, 409 |
| 2 | GET | `…/servers` | 200 `ServerResponse[]` | 401, 404 |
| 3 | GET | `…/servers/:serverId` | 200 `ServerResponse` | 401, 404 |
| 4 | POST | `…/servers/:serverId/test` | 200 `ServerTestResponse` (в т.ч. `reachable:false`, `trustRequired:true`) | 400, 401, 404, 409, 500 |
| 5 | POST | `…/servers/:serverId/agent/install` | 201 `AgentInstallResponse` | 401, 403, 404, 424, 500 |
| 6 | GET | `…/servers/:serverId/agent` | 200 `AgentResponse` | 401, 404, 424, 500 |

---

### Task 0: Тестовые БД, baseline и границы чужих правок

**Files:** нет (shell, коммита нет).

- [x] **Step 1: Создать БД под часть 3**

```bash
psql -h localhost -U sabir -d postgres -c "CREATE DATABASE bios_test_servers;"
```

Expected: `CREATE DATABASE` (повторно — `already exists`, продолжаем).

- [x] **Step 2: Прогнать существующие миграции по всем БД**

Run в `app/backend`:

```bash
for db in bios bios_test bios_test_maintenance bios_test_workspaces bios_test_servers; do
  DATABASE_URL="postgresql://sabir@localhost:5432/$db?schema=public" \
    npx prisma migrate deploy --schema=prisma/schema.prisma
done
```

Expected: везде `All migrations have been successfully applied`.

- [x] **Step 3: Зафиксировать baseline**

Run: `npx jest 2>&1 | tail -8`. Expected: suites зелёные; записать `Test Suites: N passed` — дальше число только растёт, существующие suites не должны падать.

- [x] **Step 4: Зафиксировать, что в дереве чужое, и не трогать это**

```bash
git status --short
```

Expected (не изменять и не коммитить): `M src/modules/auth/auth-cookies.ts`, `M src/modules/auth/auth.controller.ts`, `M src/modules/auth/decorators/refresh-token.decorator.ts`, `M src/modules/auth/guards/jwt.strategy.ts`, `M src/modules/users/users.controller.ts`, `?? src/modules/auth/auth-cookies.spec.ts`, `?? docs/`. Каждый свой коммит — через явный `git add <пути>`; `git add -A` запрещено.

- [x] **Step 5: Инварианты, которые план обязан сохранить**

```bash
grep -rn "process\.env" src --include="*.ts" | grep -v spec
grep -rn "new PrismaService" src --include="*.spec.ts"
```

Expected: первая — только `src/config/app.config.ts` и `src/modules/auth/auth-cookies.ts` (`isSecureCookies` с явным env-аргументом); вторая — совпадения только внутри `beforeAll`.

---

### Task 1: Prisma: `Server`, host key и раздельные оси состояний

**Files:**
- Modify: `app/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: модель `Server`; enum `ServerStatus { PENDING ONLINE OFFLINE }` (доступность SSH); enum `ServerAuthType { PASSWORD KEY }`; enum `AgentReportStatus { NOT_INSTALLED FAILED STALE ACTIVE }`; `Workspace.servers`.

- [x] **Step 1: Добавить модель и enum'ы** (в конец `schema.prisma`)

```prisma
model Server {
  id                   String            @id @default(uuid(7))
  workspaceId          String
  workspace            Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  name                 String
  host                 String
  port                 Int               @default(22)
  sshUsername          String
  authType             ServerAuthType
  secretCipher         String
  /// Принятый пользователем SHA256-отпечаток host key. NULL = ключ хоста ещё не подтверждён.
  hostKeyFingerprint   String?
  /// Только доступность SSH-хоста: PENDING/ONLINE/OFFLINE. Про Docker и агента — см. ниже.
  status               ServerStatus      @default(PENDING)
  dockerVersion        String?
  agentVersion         String?
  agentInstalledAt     DateTime?         @db.Timestamptz(3)
  /// Последнее прочитанное состояние агента (отдельная ось от status).
  lastAgentStatus      AgentReportStatus?
  lastAgentErrorCode   String?
  lastCheckedAt        DateTime?         @db.Timestamptz(3)
  createdAt            DateTime          @default(now()) @db.Timestamptz(3)
  updatedAt            DateTime          @updatedAt @db.Timestamptz(3)

  @@unique([workspaceId, name])
  @@unique([workspaceId, hostKeyFingerprint])
  @@index([workspaceId])
}

enum ServerStatus {
  PENDING
  ONLINE
  OFFLINE
}

enum ServerAuthType {
  PASSWORD
  KEY
}

enum AgentReportStatus {
  NOT_INSTALLED
  FAILED
  STALE
  ACTIVE
}
```

**Отдельная проверка ревью (важно):** `@@unique([workspaceId, hostKeyFingerprint])` выше — это ловушка: PostgreSQL считает NULL не-конфликтующими, так что несколько неподтверждённых серверов пройдут, но два сервера с **одним и тем же** отпечатком в одном воркспейсе (разные хосты за одним балансировщиком, один хост под двумя именами) упадут в `P2002` с сообщением про дубль имени. Индекс ниже — осознанное правило «один отпечаток = один сервер в воркспейсе», и оно должно быть задокументировано вместе с тестом в Task 8 (`duplicate host key → 409` с отдельным текстом). Если на ревью это сочтёт лишним — снимай строку `@@unique([workspaceId, hostKeyFingerprint])` и убери соответствующий тест; оба варианта не ломают остальной план.

В `model Workspace` добавить `servers Server[]`. `pendingHostKeyFingerprint` не заводим: непроверенный отпечаток живёт только в ответе `test`.

- [x] **Step 2: Миграция и синхронизация**

```bash
DATABASE_URL="postgresql://sabir@localhost:5432/bios?schema=public" \
  npx prisma migrate dev --name servers --schema=prisma/schema.prisma
for db in bios_test bios_test_maintenance bios_test_workspaces bios_test_servers; do
  DATABASE_URL="postgresql://sabir@localhost:5432/$db?schema=public" \
    npx prisma migrate deploy --schema=prisma/schema.prisma
done
```

Expected: `prisma/migrations/<ts>_servers/migration.sql`, везде `All migrations have been successfully applied`. Raw SQL не нужен.

- [x] **Step 3: Проверить структуру и сборку**

```bash
psql -h localhost -U sabir -d bios -c '\d "Server"'
npm run build
```

Expected: `hostKeyFingerprint` (text, nullable), `lastAgentStatus` (`AgentReportStatus`, nullable), `lastAgentErrorCode`, `secretCipher`, `status` default `PENDING`; индексы `"Server_workspaceId_name_key"` (UNIQUE), `"Server_workspaceId_hostKeyFingerprint_key"` (UNIQUE), `"Server_workspaceId_idx"`; FK `workspaceId → Workspace.id` ON DELETE CASCADE; сборка чистая.

- [x] **Step 4: Коммит**

```bash
git add app/backend/prisma/schema.prisma app/backend/prisma/migrations/*_servers
git commit -m "feat(backend): add server model with host key pin and split status"
```

---

### Task 2: AppConfig — SSH-таймауты, сетевая политика, ключи шифрования, `sshOps`

**Files:**
- Modify: `app/backend/src/config/app.config.ts`
- Modify: `app/backend/src/common/throttle/throttle-options.factory.ts`
- Test: `app/backend/src/config/app.config.spec.ts`, `src/common/throttle/throttle-profiles.spec.ts`
- Modify: `.env.template`, `docker-compose.yml` (корень репо)

**Interfaces:**
- Produces: `AppConfig.ssh: SshCfg` (см. Interfaces), `AppConfig.crypto: CryptoCfg`, `AppConfig.throttle.sshOps`, `ThrottleProfileName` + `'sshOps'`.

- [x] **Step 1: Написать падающие тесты** (helper `withKeys()` в спеке уже есть)

```ts
describe('ssh, network policy, crypto keys and sshOps', () => {
  test('defaults', () => {
    const cfg = loadAppConfig(withKeys({ NODE_ENV: 'development' }));
    expect(cfg.ssh).toEqual({
      connectTimeoutMs: 10000,
      commandTimeoutMs: 15000,
      installTimeoutMs: 60000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22],
      allowLoopback: false,
    });
    expect(cfg.throttle.sshOps).toEqual({ limit: 6, ttlMs: 60000 });
  });

  test('loopback разрешён только явным флагом; dev без флага — выключен', () => {
    expect(loadAppConfig(withKeys({ NODE_ENV: 'development' })).ssh.allowLoopback).toBe(false);
    expect(
      loadAppConfig(withKeys({ NODE_ENV: 'development', SSH_ALLOW_LOOPBACK: 'true' })).ssh.allowLoopback,
    ).toBe(true);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOW_LOOPBACK: 'yes' }))).toThrow(/SSH_ALLOW_LOOPBACK/);
  });

  test('allowedPorts принимает списки и диапазоны, отклоняет мусор', () => {
    expect(
      loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '22, 2200-2202' })).ssh.allowedPorts,
    ).toEqual([22, 2200, 2201, 2202]);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '0' }))).toThrow(/SSH_ALLOWED_PORTS/);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '70000' }))).toThrow(/SSH_ALLOWED_PORTS/);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '22-20' }))).toThrow(/SSH_ALLOWED_PORTS/);
    expect(() => loadAppConfig(withKeys({ SSH_ALLOWED_PORTS: '' }))).toThrow(/SSH_ALLOWED_PORTS/);
  });

  test('production без SERVER_CRYPTO_KEY падает; dev получает эфемерный ключ с kid k1', () => {
    expect(() =>
      loadAppConfig(withKeys({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' })),
    ).toThrow(/SERVER_CRYPTO_KEY/);
    const dev = loadAppConfig(withKeys({ NODE_ENV: 'development' }));
    expect(dev.crypto.ephemeralServerKey).toBe(true);
    expect(dev.crypto.activeKey.id).toBe('k1');
    expect(dev.crypto.activeKey.key.length).toBe(32);
    expect(dev.crypto.oldKeys.size).toBe(0);
  });

  test('OLD_KEYS декодируются по kid, кривые записи падают', () => {
    const a = Buffer.alloc(32, 7).toString('base64');
    const b = Buffer.alloc(32, 8).toString('base64');
    const cfg = loadAppConfig(
      withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_KEY_ID: 'k2', SERVER_CRYPTO_OLD_KEYS: `k1:${b}` }),
    );
    expect(cfg.crypto.activeKey.id).toBe('k2');
    expect(cfg.crypto.activeKey.key).toEqual(Buffer.alloc(32, 7));
    expect(cfg.crypto.oldKeys.get('k1')).toEqual(Buffer.alloc(32, 8));
    expect(cfg.crypto.ephemeralServerKey).toBe(false);
    expect(() =>
      loadAppConfig(withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_OLD_KEYS: `k1:${b}` })),
    ).toThrow(/already present/);
    expect(() => loadAppConfig(withKeys({ SERVER_CRYPTO_KEY: 'c2hvcnQ=' }))).toThrow(/SERVER_CRYPTO_KEY/);
    expect(() => loadAppConfig(withKeys({ SERVER_CRYPTO_KEY: a, SERVER_CRYPTO_OLD_KEYS: 'broken' }))).toThrow(
      /SERVER_CRYPTO_OLD_KEYS/,
    );
  });

  test('ssh env overrides и границы', () => {
    const cfg = loadAppConfig(
      withKeys({ SSH_CONNECT_TIMEOUT_MS: '2500', AGENT_VERSION: '1.2.3', THROTTLE_SSH_OPS_LIMIT: '2' }),
    );
    expect(cfg.ssh.connectTimeoutMs).toBe(2500);
    expect(cfg.ssh.agentVersion).toBe('1.2.3');
    expect(cfg.throttle.sshOps.limit).toBe(2);
    expect(() => loadAppConfig(withKeys({ AGENT_VERSION: 'v1' }))).toThrow(/AGENT_VERSION/);
    expect(() => loadAppConfig(withKeys({ SSH_INSTALL_TIMEOUT_MS: '0' }))).toThrow(/SSH_INSTALL_TIMEOUT_MS/);
    expect(() => loadAppConfig(withKeys({ AGENT_HEARTBEAT_STALE_SEC: '5' }))).toThrow(
      /AGENT_HEARTBEAT_STALE_SEC/,
    );
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/config/app.config.spec.ts` — Expected: FAIL.

- [x] **Step 3: Реализовать в `app.config.ts`**

Импорты: `import { randomBytes } from 'node:crypto';`. Типы:

```ts
export interface SshCfg {
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  installTimeoutMs: number;
  agentVersion: string;
  heartbeatStaleSec: number;
  allowedPorts: number[];
  allowLoopback: boolean;
}

export interface CryptoCfg {
  activeKey: { id: string; key: Buffer };
  /** Decrypt-only: старые kid'ы переживают ротацию, новый cipher ими не шифруется. */
  oldKeys: Map<string, Buffer>;
  ephemeralServerKey: boolean;
}
```

Парсеры (`positiveInt` и `parseThrottle` уже в файле):

```ts
const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;

function decodeKey(raw: string, name: string): Buffer {
  if (!/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(raw)) {
    throw new Error(`Invalid ${name}: expected base64 of 32 bytes`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`Invalid ${name}: expected 32 bytes, got ${key.length}`);
  }
  return key;
}

function parseCrypto(env: NodeJS.ProcessEnv, isProduction: boolean): CryptoCfg {
  const activeId = env.SERVER_CRYPTO_KEY_ID?.trim() || 'k1';
  if (!KEY_ID_RE.test(activeId)) {
    throw new Error(`Invalid SERVER_CRYPTO_KEY_ID="${env.SERVER_CRYPTO_KEY_ID}": expected short slug`);
  }
  const rawActive = env.SERVER_CRYPTO_KEY?.trim();
  const oldEntries = (env.SERVER_CRYPTO_OLD_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const oldKeys = new Map<string, Buffer>();
  for (const entry of oldEntries) {
    const sep = entry.indexOf(':');
    const kid = sep === -1 ? '' : entry.slice(0, sep);
    if (!KEY_ID_RE.test(kid)) {
      throw new Error(`Invalid SERVER_CRYPTO_OLD_KEYS entry "${entry}": expected kid:base64`);
    }
    oldKeys.set(kid, decodeKey(entry.slice(sep + 1), `SERVER_CRYPTO_OLD_KEYS[${kid}]`));
  }

  if (rawActive === undefined || rawActive === '') {
    if (isProduction) {
      throw new Error('Missing required SERVER_CRYPTO_KEY in production');
    }
    if (oldKeys.size > 0) {
      throw new Error(
        'Invalid SERVER_CRYPTO_OLD_KEYS: SERVER_CRYPTO_KEY is required to encrypt new credentials',
      );
    }
    return {
      activeKey: { id: activeId, key: randomBytes(32) },
      oldKeys,
      ephemeralServerKey: true,
    };
  }
  if (oldKeys.has(activeId)) {
    throw new Error(
      `SERVER_CRYPTO_KEY_ID "${activeId}" is already present in SERVER_CRYPTO_OLD_KEYS`,
    );
  }
  return {
    activeKey: { id: activeId, key: decodeKey(rawActive, 'SERVER_CRYPTO_KEY') },
    oldKeys,
    ephemeralServerKey: false,
  };
}

function parsePorts(raw: string | undefined): number[] {
  const value = raw?.trim();
  if (value === undefined || value === '') return [22];
  const ports = new Set<number>();
  for (const part of value.split(',')) {
    const token = part.trim();
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > 65535 || to < from || to - from > 63) {
        throw new Error(`Invalid SSH_ALLOWED_PORTS range "${token}": expected 1-65535, span <= 64`);
      }
      for (let p = from; p <= to; p += 1) ports.add(p);
      continue;
    }
    const single = Number(token);
    if (!/^\d{1,5}$/.test(token) || single < 1 || single > 65535) {
      throw new Error(`Invalid SSH_ALLOWED_PORTS entry "${token}": expected port 1-65535`);
    }
    ports.add(single);
  }
  if (ports.size === 0) {
    throw new Error('Invalid SSH_ALLOWED_PORTS: empty allowlist');
  }
  return [...ports].sort((a, b) => a - b);
}

function parseBool(raw: string | undefined, name: string, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Invalid ${name}="${raw}": expected true or false`);
  }
  return value === 'true';
}

function parseAgentVersion(raw: string | undefined): string {
  const value = raw ?? '0.1.0';
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Invalid AGENT_VERSION="${raw}": expected x.y.z`);
  }
  return value;
}
```

В `interface AppConfig`: `ssh: SshCfg; crypto: CryptoCfg;` и в `throttle` — `sshOps: ThrottleProfileCfg;`. `ThrottleProfileName` → `'authStrict' | 'recovery' | 'invite' | 'sshOps'`. В `loadAppConfig` собрать `ssh` (через существующий `positiveInt` с `min/max/fallback`, значения — из теста шага 1) плюс:

```ts
  allowedPorts: parsePorts(env.SSH_ALLOWED_PORTS),
  allowLoopback: parseBool(env.SSH_ALLOW_LOOPBACK, 'SSH_ALLOW_LOOPBACK', false),
```

и в `return`: `ssh`, `crypto: parseCrypto(env, isProduction)`, `sshOps: parseThrottle(env, 'THROTTLE_SSH_OPS', { limit: 6, ttlMs: 60000 })`.

Дополнительное правило: `allowLoopback === true` в `production` → `throw new Error('SSH_ALLOW_LOOPBACK=true is not allowed in production')` (тест в шаге 1: `NODE_ENV: 'production'` + флаг → `/production/`). Смысл: петлобэк — только локальная разработка и дымовой тест.

- [x] **Step 4: Профиль в throttler-фабрику**

`throttle-options.factory.ts`, пятым элементом `throttlers`:

```ts
{ ...entry('sshOps', cfg.throttle.sshOps), skipIf: skipUnless('sshOps') },
```

- [x] **Step 5: Дополнить `throttle-profiles.spec.ts`**

В `cfg`-литерал — `sshOps: { limit: 6, ttlMs: 60000 }`, в ожидаемый массив — `['sshOps', 6, 60000]`, в названии теста `4 named` → `5 named`.

Run: `npx jest src/config/ src/common/throttle/` — Expected: PASS.

- [x] **Step 6: Документация окружения**

Корневой `.env.template`, дописать:

```
# --- Servers / SSH (часть 3 MVP) ---
# Активный AES-256 ключ (base64, 32 байта) для SSH-креденшелов серверов + его kid.
# В production обязателен. Сгенерировать:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# В dev без ключа — эфемерный: записи Server не переживут рестарт.
SERVER_CRYPTO_KEY=
SERVER_CRYPTO_KEY_ID=k1
# Ротация: старый ключ остаётся здесь (decrypt-only) до перевёртки всех cipher.
# Формат: kid:base64[,kid2:base64]. Активный kid сюда не дублируется.
SERVER_CRYPTO_OLD_KEYS=

# Таймауты SSH в мс
SSH_CONNECT_TIMEOUT_MS=10000
SSH_COMMAND_TIMEOUT_MS=15000
SSH_INSTALL_TIMEOUT_MS=60000

# Политика сетевых целей: куда панели разрешено подключаться.
# Только перечисленные порты; приватные диапазоны разрешены, link-local/metadata — нет.
SSH_ALLOWED_PORTS=22
# true — разрешить loopback (только dev и дымовой тест; в production запрещено).
SSH_ALLOW_LOOPBACK=false

# Версия агента панели и порог протухания heartbeat
AGENT_VERSION=0.1.0
AGENT_HEARTBEAT_STALE_SEC=60

# Лимит роутов test / agent/install / agent
THROTTLE_SSH_OPS_LIMIT=6
THROTTLE_SSH_OPS_TTL_MS=60000
```

`docker-compose.yml`, в `services.backend.environment` после `EMAIL_VERIFY_MX`:

```yaml
      SERVER_CRYPTO_KEY: ${SERVER_CRYPTO_KEY:?set SERVER_CRYPTO_KEY env}
      SERVER_CRYPTO_KEY_ID: ${SERVER_CRYPTO_KEY_ID:-k1}
      SERVER_CRYPTO_OLD_KEYS: ${SERVER_CRYPTO_OLD_KEYS:-}
      SSH_ALLOWED_PORTS: ${SSH_ALLOWED_PORTS:-22}
      SSH_ALLOW_LOOPBACK: ${SSH_ALLOW_LOOPBACK:-false}
      AGENT_VERSION: ${AGENT_VERSION:-0.1.0}
      THROTTLE_SSH_OPS_LIMIT: ${THROTTLE_SSH_OPS_LIMIT:-6}
```

- [x] **Step 7: Проверка и коммит**

Run: `npm run build && npx prettier --check "src/config/**/*.ts" "src/common/throttle/**/*.ts"` — Expected: чисто.

```bash
git add app/backend/src/config/ app/backend/src/common/throttle/ .env.template docker-compose.yml
git commit -m "feat(backend): add ssh network policy, key ids and sshOps config"
```

---

### Task 3: Шифрование креденшелов: AES-256-GCM + kid + ротация ключа

**Files:**
- Create: `app/backend/src/modules/servers/credentials/credential-crypto.service.ts`
- Test: `app/backend/src/modules/servers/credentials/credential-crypto.service.spec.ts` (БД не нужна)

**Interfaces:**
- Consumes: `AppConfig.crypto` (Task 2).
- Produces: `CredentialCryptoService.encrypt/decrypt/needsRewrap`, формат `v1.<kid>.<iv>.<tag>.<data>`.

- [x] **Step 1: Написать падающий тест**

```ts
import { CredentialCryptoService } from './credential-crypto.service';
import type { AppConfig } from '../../../config/app.config';

const KEY_A = Buffer.alloc(32, 7);
const KEY_B = Buffer.alloc(32, 8);
const KEY_C = Buffer.alloc(32, 9);
const PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaQr\n-----END OPENSSH PRIVATE KEY-----\n';

function cfg(active: { id: string; key: Buffer }, old: Record<string, Buffer> = {}): AppConfig {
  return {
    crypto: { activeKey: active, oldKeys: new Map(Object.entries(old)), ephemeralServerKey: false },
  } as AppConfig;
}

describe('CredentialCryptoService', () => {
  test('roundtrip сохраняет плейнтекст, включая юникод и переводы строк', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    expect(s.decrypt(s.encrypt(PEM))).toBe(PEM);
    expect(s.decrypt(s.encrypt('привет pass'))).toBe('привет pass');
  });

  test('формат v1.<kid>.<iv>.<tag>.<data>, плейнтекста в cipher нет', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k7', key: KEY_A }));
    const cipher = s.encrypt('secret1234');
    expect(cipher.startsWith('v1.k7.')).toBe(true);
    expect(cipher.split('.')).toHaveLength(5);
    expect(cipher).not.toContain('secret1234');
  });

  test('одинаковый плейнтекст даёт разный cipher (уникальный IV)', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    expect(s.encrypt('secret1234')).not.toBe(s.encrypt('secret1234'));
  });

  test('ротация: старый kid читается, новый — пишется, needsRewrap=true', () => {
    const before = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    const cipher = before.encrypt('secret1234');

    const after = new CredentialCryptoService(
      cfg({ id: 'k2', key: KEY_B }, { k1: KEY_A }),
    );
    expect(after.decrypt(cipher)).toBe('secret1234');
    expect(after.needsRewrap(cipher)).toBe(true);

    const rewritten = after.encrypt(after.decrypt(cipher));
    expect(rewritten.startsWith('v1.k2.')).toBe(true);
    expect(after.needsRewrap(rewritten)).toBe(false);
    // Сервис без настроенных старых ключей не может прочитать cipher прошлого поколения.
    expect(after.oldKeysAllowed).toBe(true);
    expect(before.oldKeysAllowed).toBe(false);
    expect(() => new CredentialCryptoService(cfg({ id: 'k2', key: KEY_B })).decrypt(cipher)).toThrow(
      /unknown key id/,
    );
  });

  test('неизвестный kid и чужой ключ падают, а не возвращают мусор', () => {
    const cipher = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A })).encrypt('secret1234');
    expect(() => new CredentialCryptoService(cfg({ id: 'k1', key: KEY_B })).decrypt(cipher)).toThrow(
      'credential decryption failed',
    );
    expect(() => new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A })).decrypt('v1.zz.aaa.bbb.ccc')).toThrow(
      /unknown key id/,
    );
  });

  test('подмена ciphertext и мусор на входе падают', () => {
    const s = new CredentialCryptoService(cfg({ id: 'k1', key: KEY_A }));
    const cipher = s.encrypt('secret1234');
    const tampered = cipher.slice(0, -2) + (cipher.endsWith('AA') ? 'BB' : 'AA');
    expect(() => s.decrypt(tampered)).toThrow('credential decryption failed');
    expect(() => s.decrypt('not-a-cipher')).toThrow('credential cipher malformed');
    expect(() => s.decrypt('v2.k1.aaa.bbb.ccc')).toThrow('credential cipher malformed');
  });

  test('ключ не-32 байта падает при создании сервиса', () => {
    expect(
      () => new CredentialCryptoService(cfg({ id: 'k1', key: Buffer.alloc(16) })),
    ).toThrow(/32 bytes/);
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/credentials/` — Expected: FAIL.

- [x] **Step 3: Реализовать сервис**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';

const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** SSH-креденшелы серверов живут в БД только как AEAD-cipher с идентификатором ключа. */
@Injectable()
export class CredentialCryptoService {
  private readonly activeId: string;
  private readonly activeKey: Buffer;
  private readonly keys: Map<string, Buffer>;
  /** true, если настроены хотя бы один старый ключ (то есть ротация возможна). */
  readonly oldKeysAllowed: boolean;

  constructor(@Inject(APP_CONFIG) app: AppConfig) {
    if (app.crypto.ephemeralServerKey) {
      console.warn(
        'SERVER_CRYPTO_KEY is not set: generated an ephemeral key, stored server credentials will not survive a restart',
      );
    }
    this.activeId = app.crypto.activeKey.id;
    this.activeKey = app.crypto.activeKey.key;
    if (this.activeKey.length !== KEY_BYTES) {
      throw new Error(`Invalid server crypto key: expected ${KEY_BYTES} bytes, got ${this.activeKey.length}`);
    }
    // Активный ключ доступен и для записи, и для чтения под своим kid.
    this.keys = new Map(app.crypto.oldKeys);
    this.keys.set(this.activeId, this.activeKey);
    this.oldKeysAllowed = app.crypto.oldKeys.size > 0;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.activeKey, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      CIPHER_VERSION,
      this.activeId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }

  /** kid активного ключа — значит, строку можно перевернуть без смены пароля. */
  needsRewrap(value: string): boolean {
    const [version, kid] = value.split('.');
    return version === CIPHER_VERSION && kid !== undefined && kid !== this.activeId;
  }

  decrypt(value: string): string {
    const [version, kid, ivPart, tagPart, dataPart] = value.split('.');
    if (version !== CIPHER_VERSION || !kid || !ivPart || !tagPart || !dataPart) {
      throw new Error('credential cipher malformed');
    }
    const key = this.keys.get(kid);
    if (!key) throw new Error(`credential encrypted with unknown key id "${kid}"`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('credential decryption failed');
    }
  }
}
```

Тест `oldKeysAllowed` проверяет не поведение шифрования, а то, что сервис вообще знает о наличии старых ключей, — это нужно `ServersService` (Task 8) для решения переворачивать cipher или нет.

- [x] **Step 4: Тесты зелёные + сборка**

Run: `npx jest src/modules/servers/credentials/ && npm run build` — Expected: PASS.

- [x] **Step 5: Коммит**

```bash
git add app/backend/src/modules/servers/credentials/
git commit -m "feat(backend): encrypt server credentials with key id for rotation"
```

---

### Task 4: DTO сервера: явный `authType` вместо сломанного XOR

**Files:**
- Create: `app/backend/src/common/validators/credential-matches-auth-type.validator.ts`
- Create: `app/backend/src/modules/servers/dto/create-server.dto.ts`, `dto/server-ids.dto.ts`, `dto/test-server.dto.ts`
- Test: `app/backend/src/modules/servers/dto/dto.spec.ts`

**Interfaces:**
- Produces: `CreateServerDto { name, host, port, sshUsername, authType, sshPassword?, sshPrivateKey? }`, `ServerIdsDto`, `TestServerDto { trustHostKey? }`, `CredentialMatchesAuthType()`.

**Почему так (эмпирика, а не вкусовщина).** В class-validator 0.15.1 `@ValidateIf` с ложным предикатом пропускает **всё свойство целиком**, включая навешанный на него кастомный констрейнт: в прогоне «ни одного креденшела» и «оба креденшла» кастомный валидатор не вызывался, а `validate()` возвращал `[]`. То есть план рев.1 пропускал запрос без креденшелов вообще. Решение — перенести проверку на поле, которое всегда обязательно (`authType`), и не трогать `@ValidateIf` для формата: предикат теперь `o.authType === 'PASSWORD'`, и когда declared-поле отсутствует, `@IsString()` отрабатывает и даёт 400 (тоже проверено прогоном).

- [x] **Step 1: Написать тест (11 кейсов, ожидаемые сообщения соответствуют прогону)**

```ts
import 'reflect-metadata'; // @Type(() => Number) требует Reflect-полифил: в jest его никто не тянет
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateServerDto } from './create-server.dto';
import { ServerIdsDto } from './server-ids.dto';
import { TestServerDto } from './test-server.dto';

const V7 = '01912345-6789-7abc-aef0-1234567890ab';
const V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n';
const base = {
  name: 'prod-1',
  host: '203.0.113.10',
  port: 22,
  sshUsername: 'deploy',
};

async function errorsOf(cls: new () => object, input: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input));
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const XOR_MSG_PASSWORD = 'sshPassword is required and sshPrivateKey must be omitted for authType PASSWORD';
const MISSING_PASSWORD = 'sshPassword is required for authType PASSWORD';
const XOR_MSG_KEY = 'sshPrivateKey is required and sshPassword must be omitted for authType KEY';
const MISSING_KEY = 'sshPrivateKey is required for authType KEY';

describe('server DTOs: credential shape', () => {
  test('только пароль под authType PASSWORD — валидно', async () => {
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD', sshPassword: 'secret1234' })).toEqual([]);
  });

  test('только ключ под authType KEY — валидно', async () => {
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'KEY', sshPrivateKey: PEM })).toEqual([]);
  });

  test('ни одного креденшела — 400', async () => {
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD' })).toContain(MISSING_PASSWORD);
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'KEY' })).toContain(MISSING_KEY);
  });

  test('оба креденшела — 400 с явным указанием, что убрать', async () => {
    expect(
      await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD', sshPassword: 'secret1234', sshPrivateKey: PEM }),
    ).toContain(XOR_MSG_PASSWORD);
    expect(
      await errorsOf(CreateServerDto, { ...base, authType: 'KEY', sshPassword: 'secret1234', sshPrivateKey: PEM }),
    ).toContain(XOR_MSG_KEY);
  });

  test('креденшел не по declared authType — 400', async () => {
    // Прислан НЕ тот креденшел, что объявлен: сообщение обязан дать тот же
    // констрейнт, что и для «оба креденшла» (другой креденшел ведь присутствует).
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD', sshPrivateKey: PEM })).toContain(
      XOR_MSG_PASSWORD,
    );
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'KEY', sshPassword: 'secret1234' })).toContain(
      XOR_MSG_KEY,
    );
  });

  test('authType вне enum — 400, и сообщение не врёт про несуществующий тип', async () => {
    const messages = await errorsOf(CreateServerDto, { ...base, authType: 'AGENT', sshPassword: 'secret1234' });
    expect(messages).toContain('authType must be one of the following values: PASSWORD, KEY');
    expect(messages.filter((m) => m.includes('is required for authType'))).toEqual([]);
  });

  test('format и длина проверяются только у declared креденшела', async () => {
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD', sshPassword: 'short' })).toContain(
      'sshPassword must be longer than or equal to 8 characters',
    );
    expect(await errorsOf(CreateServerDto, { ...base, authType: 'KEY', sshPrivateKey: 'not a key at all here' })).toContain(
      'sshPrivateKey must be a PEM private key',
    );
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPrivateKey: PEM.replace('BEGIN OPENSSH', 'BEGIN PUBLIC'),
      }),
    ).toContain('sshPrivateKey must be a PEM private key');
  });

  test('ENCRYPTED-PEM проходит фильтр формы: структуру ключа проверяет сервис', async () => {
    // regex намеренно пропускает маркер ENCRYPTED (см. «Важное ограничение» ниже):
    // passphrase-защищённый ключ ловит ssh2 utils.parseKey на create (Task 8), а
    // не фильтр формы. Открытым ключом под видом приватного — вот тут regex нужен.
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPrivateKey: PEM.replace('BEGIN OPENSSH', 'BEGIN ENCRYPTED'),
      }),
    ).toEqual([]);
  });
});

describe('server DTOs: other fields', () => {
  test('host: только hostname/IPv4, без shell-метасимволов и IPv6', async () => {
    for (const bad of ['a; rm -rf /', 'host `id`', '$(id)', 'ho st', 'fe80::1', '-leading', '', 'h'.repeat(254)]) {
      expect(
        await errorsOf(CreateServerDto, { ...base, host: bad, authType: 'PASSWORD', sshPassword: 'secret1234' }),
      ).not.toEqual([]);
    }
    for (const good of ['203.0.113.10', 'srv-1.example.com', 'a', 'ab']) {
      expect(
        await errorsOf(CreateServerDto, { ...base, host: good, authType: 'PASSWORD', sshPassword: 'secret1234' }),
      ).toEqual([]);
    }
  });

  test('sshUsername — POSIX-имя', async () => {
    for (const bad of ['root x', '1user', "o'brien", 'A'.repeat(40)]) {
      expect(
        await errorsOf(CreateServerDto, { ...base, sshUsername: bad, authType: 'PASSWORD', sshPassword: 'secret1234' }),
      ).not.toEqual([]);
    }
    expect(
      await errorsOf(CreateServerDto, { ...base, sshUsername: '_deploy-9', authType: 'PASSWORD', sshPassword: 'secret1234' }),
    ).toEqual([]);
  });

  test('name тримится, port в диапазоне, дефолт 22', async () => {
    expect(
      await errorsOf(CreateServerDto, { ...base, name: '   ', authType: 'PASSWORD', sshPassword: 'secret1234' }),
    ).not.toEqual([]);
    expect(
      plainToInstance(CreateServerDto, { ...base, name: '  prod-1  ', authType: 'PASSWORD', sshPassword: 'secret1234' }).name,
    ).toBe('prod-1');
    expect(
      await errorsOf(CreateServerDto, { ...base, port: 70000, authType: 'PASSWORD', sshPassword: 'secret1234' }),
    ).not.toEqual([]);
    expect(
      await errorsOf(CreateServerDto, { ...base, port: '2222', authType: 'PASSWORD', sshPassword: 'secret1234' }),
    ).toEqual([]);
    expect(new CreateServerDto().port).toBe(22);
  });

  test('ServerIdsDto — оба uuid v7; TestServerDto — fingerprint формата SHA256:<base64>', async () => {
    expect(await errorsOf(ServerIdsDto, { workspaceId: V7, serverId: V7 })).toEqual([]);
    expect(await errorsOf(ServerIdsDto, { workspaceId: V7, serverId: V4 })).not.toEqual([]);
    const fp = `SHA256:${'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}`;
    expect(await errorsOf(TestServerDto, {})).toEqual([]);
    expect(await errorsOf(TestServerDto, { trustHostKey: fp })).toEqual([]);
    expect(await errorsOf(TestServerDto, { trustHostKey: 'AA'.repeat(40) })).not.toEqual([]);
    expect(await errorsOf(TestServerDto, { trustHostKey: 'SHA256:short' })).not.toEqual([]);
    // Неизвестное поле отсекает глобальный ValidationPipe (whitelist +
    // forbidNonWhitelisted) на HTTP-границе; class-validator про него не знает,
    // поэтому в юните проверяем тип: не-строка должна падать.
    expect(await errorsOf(TestServerDto, { trustHostKey: 42 })).not.toEqual([]);
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/dto/` — Expected: FAIL.

- [x] **Step 3: Создать валидатор**

```ts
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

type CredentialCarrier = { sshPassword?: unknown; sshPrivateKey?: unknown };

const present = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0;

@ValidatorConstraint({ name: 'credentialMatchesAuthType', async: false })
class CredentialMatchesAuthTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as CredentialCarrier;
    const password = present(object.sshPassword);
    const key = present(object.sshPrivateKey);
    if (value === 'PASSWORD') return password && !key;
    if (value === 'KEY') return key && !password;
    // Неизвестный authType — не наша проблема: @IsIn уже даёт 400.
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const object = args.object as CredentialCarrier;
    const declared = args.value === 'PASSWORD' ? 'sshPassword' : 'sshPrivateKey';
    const other = args.value === 'PASSWORD' ? 'sshPrivateKey' : 'sshPassword';
    if (present(object[other])) {
      return `${declared} is required and ${other} must be omitted for authType ${String(args.value)}`;
    }
    return `${declared} is required for authType ${String(args.value)}`;
  }
}

/**
 * Проверка «declared authType ↔ ровно один креденшел» живёт на обязательном поле
 * authType, потому что @ValidateIf пропускает свойство ЦЕЛИКОМ (проверено на
 * class-validator 0.15.1): на факультативных полях такой констрейнт не выполнился
 * бы при отсутствии обоих креденшелов.
 */
export function CredentialMatchesAuthType(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: CredentialMatchesAuthTypeConstraint,
    });
  };
}
```

Форма `@ValidatorConstraint`-класса, а не литерала объекта — как в `reserved-username.validator.ts` и `disposable-email.validator.ts`, чтобы модуль не вводил второй стиль.

- [x] **Step 4: Создать DTO**

```ts
// create-server.dto.ts
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ServerAuthType } from '@prisma/client';
import { CredentialMatchesAuthType } from '../../../common/validators/credential-matches-auth-type.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateServerDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  name: string;

  /** Только hostname или IPv4: без пробелов, без shell-метасимволов, без IPv6. */
  @Transform(lower)
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/, {
    message: 'host must be a hostname or IPv4 literal without spaces or shell metacharacters',
  })
  host: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number = 22;

  @Transform(lower)
  @IsString()
  @Matches(/^[a-z_][a-z0-9_-]{0,31}$/, { message: 'sshUsername must be a POSIX user name' })
  sshUsername: string;

  @IsIn([ServerAuthType.PASSWORD, ServerAuthType.KEY], {
    message: `authType must be one of the following values: ${ServerAuthType.PASSWORD}, ${ServerAuthType.KEY}`,
  })
  @CredentialMatchesAuthType()
  authType: ServerAuthType;

  @ValidateIfPassword()
  @IsString()
  @Length(8, 512)
  sshPassword?: string;

  @ValidateIfKey()
  @IsString()
  @Matches(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, {
    message: 'sshPrivateKey must be a PEM private key',
  })
  @Length(32, 16384)
  sshPrivateKey?: string;
}
```

Два хелпера-декоратора выше — это не новый API, а `@ValidateIf` со стрелочным предикатом; в файле они оформлены так (иначе тест «креденшел не по declared authType» не сойдётся):

```ts
import { ValidateIf } from 'class-validator';

const ValidateIfPassword = () =>
  ValidateIf((o: CreateServerDto) => o.authType === ServerAuthType.PASSWORD);
const ValidateIfKey = () => ValidateIf((o: CreateServerDto) => o.authType === ServerAuthType.KEY);
```

`server-ids.dto.ts`:

```ts
import { IsUUID } from 'class-validator';

export class ServerIdsDto {
  @IsUUID('7')
  workspaceId: string;

  @IsUUID('7')
  serverId: string;
}
```

`test-server.dto.ts`:

```ts
import { IsOptional, Matches } from 'class-validator';

/** Подтверждение отпечатка: клиент обязан прислать ровно то, что вернул предыдущий test. */
export class TestServerDto {
  @IsOptional()
  @Matches(/^SHA256:[A-Za-z0-9+/]{43}={0,2}$/, {
    message: 'trustHostKey must be a SHA256:<base64> host key fingerprint',
  })
  trustHostKey?: string;
}
```

Важное ограничение этого DTO, которое надо помнить при ревью: regex `sshPrivateKey` принимает маркер `ENCRYPTED`-PEM (чтобы сообщение было честным «must be a PEM private key»), а настоящую структуру ключа и факт шифрования сервис отвергает на `create` (Task 8, `utils.parseKey`). Regex — это грубый фильтр формы, не валидация ключа.

- [x] **Step 5: Тесты зелёные + сборка**

Run: `npx jest src/modules/servers/dto/ && npm run build && npx prettier --check "src/modules/servers/dto/**" "src/common/validators/**"` — Expected: PASS.

- [x] **Step 6: Коммит**

```bash
git add app/backend/src/common/validators/credential-matches-auth-type.validator.ts app/backend/src/modules/servers/dto/
git commit -m "feat(backend): add server DTOs with explicit auth type validation"
```

---

### Task 5: Политика сетевых целей (закрытие SSRF-вектора)

**Files:**
- Create: `app/backend/src/modules/servers/ssh/ssh-runner.ts` — полный `SshErrorCode`, `SshFailure`, `SshSession`, `SshExecResult`, `SshRunner`, `SSH_RUNNER` (файл нужен обоим задачам, поэтому создаётся здесь)
- Create: `app/backend/src/modules/servers/ssh/network-policy.ts`
- Test: `app/backend/src/modules/servers/ssh/network-policy.spec.ts` (без сети и БД)

**Interfaces:**
- Produces: `SshFailure` (см. Interfaces выше), `ipCategory`, `parseHostLiteral`, `resolveTarget`, `NetworkPolicy`, `Resolver`. Task 6 дописывает в этот же модуль хост-ключ, адаптер и двойной — менять `ssh-runner.ts` в Task 6 не нужно.

Политика (решение, а не заглушка): разрешены `public` и `private` (включая CGNAT `100.64/10` и `fc00::/7`) — это основной сценарий продукта «свой сервер в локальной сети»; `loopback` — только при `allowLoopback` (dev/дымовой тест); запрещены `linkLocal` (в т.ч. `169.254.169.254` — метаданные облака), `unspecified`, `multicast`, `other`. Порт — только из allowlist. Соединение идёт по **проверенному IP**, поэтому повторное DNS-разрешение не может увести трафик на запрещённый адрес (rebinding закрыт конструкцией, а не гонкой).

- [x] **Step 1: Написать падающий тест**

```ts
import { SshFailure } from './ssh-runner';
import { ipCategory, parseHostLiteral, resolveTarget, type NetworkPolicy } from './network-policy';

const policy: NetworkPolicy = { allowedPorts: [22, 2202], allowLoopback: false };
const policyWithLoopback: NetworkPolicy = { allowedPorts: [22, 2202], allowLoopback: true };

const fail = async (host: string, port = 22, p = policy): Promise<string> => {
  try {
    await resolveTarget(host, port, p, async () => []);
    return 'no-error';
  } catch (err) {
    return err instanceof SshFailure ? err.code : `wrong-error:${String(err)}`;
  }
};

describe('ipCategory', () => {
  test('IPv4 разбирается по диапазонам', () => {
    expect(ipCategory('203.0.113.10')).toBe('public');
    expect(ipCategory('10.0.0.5')).toBe('private');
    expect(ipCategory('172.16.0.1')).toBe('private');
    expect(ipCategory('192.168.1.1')).toBe('private');
    expect(ipCategory('100.64.0.1')).toBe('private');
    expect(ipCategory('127.0.0.1')).toBe('loopback');
    expect(ipCategory('169.254.169.254')).toBe('linkLocal');
    expect(ipCategory('0.0.0.0')).toBe('unspecified');
    expect(ipCategory('224.0.0.5')).toBe('multicast');
    expect(ipCategory('240.0.0.1')).toBe('other');
    expect(ipCategory('not-an-ip')).toBe('invalid');
  });

  test('IPv6: loopback, link-local, unique-local, multicast, IPv4-mapped', () => {
    expect(ipCategory('::1')).toBe('loopback');
    expect(ipCategory('::')).toBe('unspecified');
    expect(ipCategory('fe80::1')).toBe('linkLocal');
    expect(ipCategory('fd12::34')).toBe('private');
    expect(ipCategory('ff02::1')).toBe('multicast');
    expect(ipCategory('2001:db8::1')).toBe('documentation');
    expect(ipCategory('::ffff:169.254.169.254')).toBe('linkLocal');
    expect(ipCategory('::ffff:203.0.113.10')).toBe('public');
  });
});

describe('parseHostLiteral', () => {
  test('голый IPv4 и IPv6 в скобках распознаются, имена — нет', () => {
    expect(parseHostLiteral('203.0.113.10')).toBe('203.0.113.10');
    expect(parseHostLiteral('[fe80::1]')).toBe('fe80::1');
    expect(parseHostLiteral('srv.example.com')).toBeNull();
    expect(parseHostLiteral('203.0.113.999')).toBeNull();
  });
});

describe('resolveTarget', () => {
  test('метаданные облака и link-local блокируются до соединения', async () => {
    expect(await fail('169.254.169.254')).toBe('TARGET_BLOCKED');
    expect(await fail('fe80::1')).toBe('TARGET_BLOCKED');
    expect(await fail('0.0.0.0')).toBe('TARGET_BLOCKED');
    expect(await fail('224.0.0.5')).toBe('TARGET_BLOCKED');
    expect(await fail('240.0.0.1')).toBe('TARGET_BLOCKED');
  });

  test('приватные и публичные адреса разрешены', async () => {
    const resolver = async () => [];
    await expect(resolveTarget('10.0.0.5', 22, policy, resolver)).resolves.toEqual({ address: '10.0.0.5' });
    await expect(resolveTarget('203.0.113.10', 22, policy, resolver)).resolves.toEqual({
      address: '203.0.113.10',
    });
    await expect(resolveTarget('192.168.1.20', 2202, policy, resolver)).resolves.toEqual({
      address: '192.168.1.20',
    });
  });

  test('loopback зависит от флага', async () => {
    expect(await fail('127.0.0.1')).toBe('TARGET_BLOCKED');
    await expect(resolveTarget('127.0.0.1', 22, policyWithLoopback, async () => [])).resolves.toEqual({
      address: '127.0.0.1',
    });
  });

  test('порт вне allowlist блокируется раньше, чем адрес', async () => {
    expect(await fail('203.0.113.10', 23)).toBe('PORT_NOT_ALLOWED');
    expect(await fail('169.254.169.254', 23)).toBe('PORT_NOT_ALLOWED');
  });

  test('имя хоста резолвится, проверяется каждый адрес, соединяемся по проверенному IP', async () => {
    const calls: string[] = [];
    const resolver = async (host: string) => {
      calls.push(host);
      return ['169.254.169.254', '203.0.113.77'];
    };
    await expect(resolveTarget('ok.example.com', 22, policy, resolver)).resolves.toEqual({
      address: '203.0.113.77',
    });
    expect(calls).toEqual(['ok.example.com']);
  });

  test('если все разрешённые адреса отсутствуют — TARGET_BLOCKED, если ни одного — RESOLUTION_FAILED', async () => {
    expect(await fail('only-metadata.example.com', 22, policy, async () => ['169.254.169.254'])).toBe(
      'TARGET_BLOCKED',
    );
    expect(await fail('nx.example.com', 22, policy, async () => [])).toBe('RESOLUTION_FAILED');
    expect(await fail('nx.example.com', 22, policy, async () => { throw new Error('EAI_AGAIN'); })).toBe(
      'RESOLUTION_FAILED',
    );
  });

  test('сообщение не раскрывает внутренний адрес больше, чем нужно', async () => {
    await resolveTarget('169.254.169.254', 22, policy, async () => []).catch((err: SshFailure) => {
      expect(err.message).toBe('target address is not allowed');
      expect(err.message).not.toContain('169.254');
    });
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/ssh/network-policy.spec.ts` — Expected: FAIL.

Шага не было в черновике, но реализация проверяет больше snippets выше: отдельный тест на то, что глобальный unicast (`2001:4860:4860::8888`) не путается с `documentation`; тест на hex-форму отображённого IPv4 (`::ffff:a9fe:a9fe`, `::a9fe:a9fe`); тест на мусорные адреса (`:::`, `gg00::1`, `1.2.3.4.5`, `300.1.1.1`); `resolveTarget` на `[::ffff:a9fe:a9fe]`; и приоритет IPv4 в смешанном DNS-ответе. Резолверы в спеке — не `async () => []`, а хелперы `resolves(...)`/`rejects`, иначе eslint `require-await` краснеет.

- [x] **Step 3: Создать `ssh-runner.ts` — полный набор кодов ошибки и токен**

```ts
import type { ServerAuthType } from '@prisma/client';

export type SshErrorCode =
  | 'AUTH_FAILED' | 'TIMEOUT' | 'REFUSED' | 'DNS' | 'HOST_KEY' | 'NETWORK'
  | 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH'
  | 'TARGET_BLOCKED' | 'PORT_NOT_ALLOWED' | 'RESOLUTION_FAILED'
  | 'DOCKER_MISSING' | 'DOCKER_PERMISSION_DENIED' | 'DOCKER_SOCKET_UNREACHABLE'
  | 'SYSTEMD_MISSING' | 'SUDO_REQUIRED' | 'MANIFEST_INVALID' | 'IDENTITY_MISMATCH'
  | 'AGENT_NOT_RUNNING' | 'AGENT_HEARTBEAT_STALE' | 'AGENT_VERSION_MISMATCH'
  | 'AGENT_MANIFEST_MISSING'
  | 'COMMAND_FAILED' | 'READ_FAILED';

export class SshFailure extends Error {
  constructor(
    readonly code: SshErrorCode,
    message: string,
    /** Заполняется, когда наблюдали ключ хоста: режим probe и несовпадение пина. */
    readonly observedHostKeyFingerprint?: string,
  ) {
    super(message);
    this.name = 'SshFailure';
  }
}

export interface SshSession {
  host: string;
  /** Проверенный политикой адрес: подключаемся именно к нему. */
  address: string;
  port: number;
  username: string;
  authType: ServerAuthType;
  secret: string;
  /** null = probe: проверяем host key, креденшелы не отправляем. */
  expectedHostKeyFingerprint: string | null;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface SshRunner {
  exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult>;
}

export const SSH_RUNNER = Symbol('SSH_RUNNER');
```

- [x] **Step 4: Реализовать `network-policy.ts`**

```ts
import { promises as dns } from 'node:dns';
import { SshFailure } from './ssh-runner';

export type IpCategory =
  | 'loopback'
  | 'linkLocal'
  | 'unspecified'
  | 'multicast'
  | 'private'
  | 'public'
  | 'documentation'
  | 'other'
  | 'invalid';

export interface NetworkPolicy {
  allowedPorts: number[];
  allowLoopback: boolean;
}

export type Resolver = (host: string) => Promise<string[]>;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function octetsOfV4(ip: string): [number, number, number, number] | null {
  const match = IPV4_RE.exec(ip.trim());
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  if (octets.some((o) => o > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

function categoryOfV4(a: number, b: number, c: number, d: number): IpCategory {
  if (a === 0 && b === 0 && c === 0 && d === 0) return 'unspecified';
  if (a === 0) return 'other'; // 0.0.0.0/8 — «эта сеть»
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'linkLocal'; // включая 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'other';
  return 'public';
}

/** Разбирает группу hex-частей IPv6, допуская хвост в виде IPv4. */
function groupsFromParts(part: string): number[] | null {
  if (part === '') return [];
  const items = part.split(':');
  const groups: number[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (index === items.length - 1) {
      const embedded = octetsOfV4(item);
      if (embedded) {
        const [a, b, c, d] = embedded;
        groups.push((a << 8) | b, (c << 8) | d);
        continue;
      }
    }
    if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
    groups.push(parseInt(item, 16));
  }
  return groups;
}

/**
 * IPv6 → 8 групп по 16 бит. Разбор свой, а не через `net`: категория должна
 * считаться по битам, иначе '::ffff:a9fe:a9fe' обойдёт проверку 169.254/16.
 */
export function parseIpv6(ip: string): number[] | null {
  const value = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!/^[0-9a-f:.]+$/.test(value)) return null;
  const sides = value.split('::');
  if (sides.length > 2) return null;
  const head = groupsFromParts(sides[0]);
  if (!head) return null;
  if (sides.length === 1) return head.length === 8 ? head : null;
  const tail = groupsFromParts(sides[1]);
  if (!tail) return null;
  // '::' обязана скрывать хотя бы одну нулевую группу.
  if (head.length + tail.length > 7) return null;
  return [
    ...head,
    ...Array.from({ length: 8 - head.length - tail.length }, () => 0),
    ...tail,
  ];
}

function categoryOfV6(groups: number[]): IpCategory {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((g) => g === 0)) return 'unspecified';
  if (g7 === 1 && groups.slice(0, 7).every((g) => g === 0)) return 'loopback';
  // '::ffff:a9fe:a9fe' и '::a9fe:a9fe' — это 169.254.169.254, а не «public»:
  // категорию считаем по вложенному IPv4, иначе hex-форма обходит политику.
  if (
    [g0, g1, g2, g3, g4].every((g) => g === 0) &&
    (g5 === 0xffff || g5 === 0)
  ) {
    return categoryOfV4((g6 >> 8) & 255, g6 & 255, (g7 >> 8) & 255, g7 & 255);
  }
  if ((g0 & 0xffc0) === 0xfe80) return 'linkLocal'; // fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return 'private'; // fc00::/7
  if ((g0 & 0xff00) === 0xff00) return 'multicast'; // ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation'; // 2001:db8::/32
  return 'public';
}
```

Две правки против черновика политики (обе пойманы тестами Task 5 и обе — дыры, а не косметика):

1. Проверка `linkLocal` через `(firstGroup & 0xfe00) === 0xfe00 && (firstGroup & 0x0f00) === 0x0c00` не срабатывала на `fe80::1` (`0xfe80 & 0x0f00 = 0x0e00`), и адрес падал в нижнюю ветку. Корректная маска для `fe80::/10` — `(g0 & 0xffc0) === 0xfe80`.
2. Нижняя ветка `(firstGroup & 0x2000) === 0x2000` помечала как `documentation` весь `2000::/3`, то есть почти весь глобальный unicast, — рабочие серверы блокировались бы. Учебный диапазон — ровно `2001:db8::/32`, поэтому сравниваем две первые группы с `0x2001` и `0x0db8`.

Ещё одна причина своего парсера вместо «первый hex-группой»: `Number('0x' + …)` молча принимает `parseInt`-мусор и не видит ни сжатия `::`, ни IPv4-хвоста, ни hex-формы отображённого адреса — а именно эти формы и надо ловить.

```ts
export function ipCategory(ip: string): IpCategory {
  const value = ip.trim().replace(/^\[|\]$/g, '');
  const v4 = octetsOfV4(value);
  if (v4) return categoryOfV4(...v4);
  if (value.includes(':')) {
    const groups = parseIpv6(value);
    return groups ? categoryOfV6(groups) : 'invalid';
  }
  return 'invalid';
}

/** Голый IPv4 или IPv6 в скобках; для имени возвращает null. */
export function parseHostLiteral(host: string): string | null {
  const bare = host.trim().replace(/^\[|\]$/g, '');
  if (octetsOfV4(bare)) return bare;
  if (bare.includes(':') && parseIpv6(bare)) return bare.toLowerCase();
  return null;
}

function isAllowed(category: IpCategory, policy: NetworkPolicy): boolean {
  if (category === 'private' || category === 'public') return true;
  if (category === 'loopback') return policy.allowLoopback;
  return false; // linkLocal, unspecified, multicast, documentation, other, invalid
}

export async function resolveTarget(
  host: string,
  port: number,
  policy: NetworkPolicy,
  resolve: Resolver = defaultResolver,
): Promise<{ address: string }> {
  if (!policy.allowedPorts.includes(port)) {
    throw new SshFailure('PORT_NOT_ALLOWED', 'port is not allowed');
  }
  const literal = parseHostLiteral(host);
  if (literal !== null) {
    if (!isAllowed(ipCategory(literal), policy)) {
      throw new SshFailure('TARGET_BLOCKED', 'target address is not allowed');
    }
    return { address: literal };
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new SshFailure('RESOLUTION_FAILED', 'host name cannot be resolved');
  }
  if (addresses.length === 0) {
    throw new SshFailure('RESOLUTION_FAILED', 'host name cannot be resolved');
  }
  // Детерминированный порядок: сначала IPv4 (стабильнее в смешанных сетях).
  const ordered = [...addresses].sort((a, b) => Number(b.includes(':')) - Number(a.includes(':')));
  for (const address of ordered) {
    if (isAllowed(ipCategory(address), policy)) return { address };
  }
  throw new SshFailure('TARGET_BLOCKED', 'target address is not allowed');
}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}
```

`documentation`-категория для `2001:db8::/32` блокируется намеренно: это учебный диапазон, рабочий сервер там быть не может, а тесты на нём дают нам бесплатный кейс «заблокировано, а не «разрешено по умолчанию».

- [x] **Step 5: Тесты зелёные + сборка**

Run: `npx jest src/modules/servers/ssh/ && npm run build` — Expected: PASS.

- [x] **Step 6: Коммит**

```bash
git add app/backend/src/modules/servers/ssh/
git commit -m "feat(backend): restrict ssh targets with address and port policy"
```

(В `git add` входит весь каталог `ssh/`: `ssh-runner.ts` создан в этой же задаче, и в черновике шага он в команде коммита отсутствовал бы — файл остался бы незакоммиченным.)

---

### Task 6: SSH-шов: host key TOFU, классификация сбоев, реальные тесты адаптера

**Files:**
- Modify: `app/backend/package.json`, `package-lock.json` — `node-ssh@^13.2.1`, `ssh2@^1.14.0` (прямой: `utils.parseKey` + `Server` в тестах), dev `@types/ssh2`
- Create: `ssh/host-key.ts`, `ssh/classify-ssh-error.ts`, `ssh/node-ssh.runner.ts`, `ssh/fake-ssh.runner.ts` (`ssh/ssh-runner.ts` — уже Task 5)
- Create (тестовая инфраструктура): `src/modules/servers/ssh/testing/ssh-server-fixture.ts`
- Test: `ssh/classify-ssh-error.spec.ts`, `ssh/host-key.spec.ts`, `ssh/node-ssh.runner.spec.ts`

**Interfaces:**
- Consumes: `NetworkPolicy`/`resolveTarget` (Task 5), `ServerAuthType` (Task 1), `AppConfig.ssh` (Task 2).
- Produces: `SshSession`, `SshExecResult`, `SshErrorCode`, `SshFailure`, `SshRunner`, `SSH_RUNNER`, `hostKeyFingerprint`, `classifySshError`, `NodeSshRunner`, `FakeSshRunner`, `startSshFixture`.

- [x] **Step 1: Поставить зависимости и зафиксировать поведение ssh2**

Run в `app/backend`:

```bash
npm i node-ssh@^13.2.1 ssh2@^1.14.0 && npm i -D @types/ssh2
node -e "const {NodeSSH}=require('node-ssh');const s=new NodeSSH();console.log(typeof s.execCommand, typeof s.dispose)"
node -e "const {utils,Server}=require('ssh2');console.log(typeof utils.parseKey, typeof Server)"
```

Expected: `function function` и `function function`. Это подтверждает: (а) API `execCommand → {stdout, stderr, code}`, (б) `dispose()` синхронный, (в) `utils.parseKey` и in-process `Server` доступны — на них опираются Task 8 и тесты адаптера.

- [x] **Step 2: Написать тест fingerprint и классификации (падающий)**

```ts
// ssh/host-key.spec.ts
import { createHash } from 'node:crypto';
import { hostKeyFingerprint } from './host-key';

describe('hostKeyFingerprint', () => {
  test('совпадает с OpenSSH-форматом base64(sha256(blob)) без padding', () => {
    const blob = Buffer.from([0x00, 0x00, 0x00, 0x07, 0x73, 0x73, 0x68, 0x2d, 0x72, 0x73, 0x61]);
    const expected = `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
    expect(hostKeyFingerprint(blob)).toBe(expected);
    expect(hostKeyFingerprint(blob)).not.toContain('=');
  });
});
```

```ts
// ssh/classify-ssh-error.spec.ts
import { classifySshError } from './classify-ssh-error';

function err(message: string, code?: string): Error & { code?: string } {
  const e = new Error(message) as Error & { code?: string };
  e.code = code;
  return e;
}

describe('classifySshError', () => {
  test('аутентификация, handshake-таймаут и DNS различимы', () => {
    expect(classifySshError(err('All configured authentication methods failed'))).toBe('AUTH_FAILED');
    expect(classifySshError(err('Timed out while waiting for handshake'))).toBe('TIMEOUT');
    expect(classifySshError(err('', 'ETIMEDOUT'))).toBe('TIMEOUT');
    expect(classifySshError(err('getaddrinfo ENOTFOUND nowhere.invalid'))).toBe('DNS');
    expect(classifySshError('EAI_AGAIN example.com')).toBe('DNS');
  });

  test('ECONNRESET — это NETWORK, а не TIMEOUT (замечание ревью №11)', () => {
    expect(classifySshError(err('socket hang up', 'ECONNRESET'))).toBe('NETWORK');
    expect(classifySshError(err('Connection reset by peer'))).toBe('NETWORK');
  });

  test('отказ в соединении и проблема с host key', () => {
    expect(classifySshError(err('connect ECONNREFUSED 127.0.0.1:22'))).toBe('REFUSED');
    expect(classifySshError(err('Received mismatching host key'))).toBe('HOST_KEY');
  });

  test('всё остальное — NETWORK, включая неизвестные формы', () => {
    expect(classifySshError(err('something strange'))).toBe('NETWORK');
    expect(classifySshError(undefined)).toBe('NETWORK');
    expect(classifySshError({ nope: true })).toBe('NETWORK');
  });
});
```

- [x] **Step 3: Реализовать fingerprint и классификацию** (`ssh-runner.ts` уже создан в Task 5 — не дублируем)

```ts
// ssh/host-key.ts
import { createHash } from 'node:crypto';

/** OpenSSH-совместимый отпечаток: base64(sha256(wire-blob)) без паддинга, префикс SHA256:. */
export function hostKeyFingerprint(rawKey: Buffer): string {
  return `SHA256:${createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')}`;
}
```

```ts
// ssh/classify-ssh-error.ts
import type { SshErrorCode } from './ssh-runner';

export function classifySshError(err: unknown): SshErrorCode {
  const e = err as (Error & { code?: string; name?: string }) | undefined;
  const text = `${e?.code ?? ''} ${e?.name ?? ''} ${e?.message ?? String(err ?? '')}`.toLowerCase();

  if (text.includes('all configured authentication methods failed')) return 'AUTH_FAILED';
  if (text.includes('host key') || text.includes('handshake failed')) return 'HOST_KEY';
  if (text.includes('econnrefused')) return 'REFUSED';
  if (text.includes('enotfound') || text.includes('eai_again') || text.includes('getaddrinfo')) {
    return 'DNS';
  }
  if (text.includes('timed out') || text.includes('etimedout') || text.includes('timeout')) {
    return 'TIMEOUT';
  }
  // ECONNRESET/«reset by peer» — это разрыв, а не истечение времени (ревью №11).
  return 'NETWORK';
}
```

- [x] **Step 4: Реализовать `node-ssh.runner.ts`**

Ключевое (и это ровно то, на что указывает ловушка в Global Constraints): верификатор пишет наблюдаемый отпечаток в замыкание, и **до** классификации транспортного сбоя адаптер сам решает, что это `HOST_KEY_NOT_TRUSTED`/`HOST_KEY_MISMATCH`. Иначе node-ssh отдаст `SSHError('No response from server', 'ETIMEDOUT')` и мы соврём про таймаут.

```ts
import { Inject, Injectable } from '@nestjs/common';
import { NodeSSH, type Config } from 'node-ssh';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';
import { classifySshError } from './classify-ssh-error';
import { hostKeyFingerprint } from './host-key';
import {
  SshFailure,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh-runner';

@Injectable()
export class NodeSshRunner implements SshRunner {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult> {
    const ssh = new NodeSSH();
    let observed: string | null = null;
    let rejectedByPolicy = false;

    const config: Config = {
      host: session.address,
      port: session.port,
      username: session.username,
      readyTimeout: this.cfg.ssh.connectTimeoutMs,
      // tryKeyboard НЕ ставим: обработчика keyboard-interactive нет (ревью №10).
      hostVerifier: (key: Buffer | string): boolean => {
        observed = hostKeyFingerprint(Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex'));
        const expected = session.expectedHostKeyFingerprint;
        if (expected === null) {
          rejectedByPolicy = true; // probe: ключ увидели, креденшелы не отправим
          return false;
        }
        if (observed !== expected) {
          rejectedByPolicy = true;
          return false;
        }
        return true;
      },
      ...(session.authType === 'PASSWORD'
        ? { password: session.secret }
        : { privateKey: session.secret }),
    };

    let guard: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      guard = setTimeout(
        () => reject(new SshFailure('TIMEOUT', 'ssh operation timed out')),
        timeoutMs,
      );
      guard.unref();
    });

    try {
      await Promise.race([ssh.connect(config), timeout]);
      if (rejectedByPolicy) {
        // connect не мог «удастся», если верификатор вернул false; на всякий случай
        // не интерпретируем это как успех.
        throw new SshFailure(
          session.expectedHostKeyFingerprint === null
            ? 'HOST_KEY_NOT_TRUSTED'
            : 'HOST_KEY_MISMATCH',
          'host key is not trusted',
          observed ?? undefined,
        );
      }
      const res = await Promise.race([ssh.execCommand(command), timeout]);
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    } catch (err) {
      if (rejectedByPolicy) {
        throw new SshFailure(
          session.expectedHostKeyFingerprint === null
            ? 'HOST_KEY_NOT_TRUSTED'
            : 'HOST_KEY_MISMATCH',
          session.expectedHostKeyFingerprint === null
            ? 'host key is not trusted yet'
            : 'host key does not match the pinned fingerprint',
          observed ?? undefined,
        );
      }
      if (err instanceof SshFailure) throw err;
      throw new SshFailure(classifySshError(err), 'ssh transport failure');
    } finally {
      if (guard) clearTimeout(guard);
      ssh.dispose();
    }
  }
}
```

Замечание для ревью: `hostHash` мы НЕ выставляем, поэтому `key` приходит raw-буфером (совпадает с определением OpenSSH). Ветку `hex` оставил на случай, если будущая версия ssh2 начнёт отдавать хеш — она не должна тихо ломать пин.

- [x] **Step 5: Реализовать `fake-ssh.runner.ts`** (расходы ответов по одному — иначе нельзя выразить «до установки / после установки»)

```ts
import {
  SshFailure,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh-runner';

type Reply =
  | { kind: 'result'; match: RegExp; result: SshExecResult; used: boolean }
  | { kind: 'failure'; match: RegExp; error: Error; used: boolean };

/**
 * Детерминированный двойной SSH-канала: помнит сессии и команды, отвечает по regex.
 * Каждый зарекаенный ответ расходуется один раз (FIFO среди подходящих).
 * expectHostKeyProbe() доказывает, что в probe-режиме креденшелы не покидают процесс.
 */
export class FakeSshRunner implements SshRunner {
  readonly commands: string[] = [];
  readonly sessions: SshSession[] = [];
  readonly probes: string[] = [];
  private readonly replies: Reply[] = [];

  respond(match: RegExp, stdout: string, opts: { code?: number; stderr?: string } = {}): this {
    this.replies.push({
      kind: 'result',
      match,
      used: false,
      result: { stdout, stderr: opts.stderr ?? '', code: opts.code ?? 0 },
    });
    return this;
  }

  fail(match: RegExp, error: Error): this {
    this.replies.push({ kind: 'failure', match, error, used: false });
    return this;
  }

  /** Заранее зарекаенный host-key-сценарий: наблюдаемый отпечаток + код ошибки. */
  hostKey(match: RegExp, observed: string, code: 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH'): this {
    return this.fail(match, new SshFailure(code, 'host key is not trusted', observed));
  }

  async exec(session: SshSession, command: string): Promise<SshExecResult> {
    this.sessions.push(session);
    this.commands.push(command);
    if (session.expectedHostKeyFingerprint === null) {
      this.probes.push(session.secret); // в probe-режиме секрет не должен «использоваться»
    }
    const hit = this.replies.find((r) => !r.used && r.match.test(command));
    if (!hit) {
      throw new Error(`FakeSshRunner: no scripted reply left for remote command\n${command}`);
    }
    hit.used = true;
    if (hit.kind === 'failure') throw hit.error;
    return hit.result;
  }

  /** Ни одна сессия probe не должна была «отправить» секрет: проверяем, что его нет в командах. */
  assertNoSecretLeak(secret: string): void {
    if (this.commands.some((c) => c.includes(secret))) {
      throw new Error('remote command contains the credential');
    }
  }
}
```

- [x] **Step 6: Реализовать фикстуру `ssh/testing/ssh-server-fixture.ts`**

Настоящий SSH-сервер в том же процессе: проверяет рукопожатие, фиксирует, была ли попытка аутентификации, и умеет «зависать» — это единственное честное доказательство того, что probe не отправляет креденшелы, и что таймауты и `dispose()` работают.

```ts
import { Server, utils, type ClientChannel, type Connection } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { hostKeyFingerprint } from '../host-key';

export interface FixtureOptions {
  /** Принимать ли password-аутентификацию с этим паролем. */
  password?: string;
  exec?: { stdout?: string; stderr?: string; code?: number };
  /** 'hang' — сессию не открывать вовсе (команда «зависает»). */
  behavior?: 'normal' | 'reject-auth' | 'hang-auth' | 'hang-exec' | 'reset-after-auth';
}

export interface SshFixture {
  port: number;
  fingerprint: string;
  authAttempts: number;
  execRequests: string[];
  closedConnections: number;
  close(): Promise<void>;
}

export async function startSshFixture(options: FixtureOptions = {}): Promise<SshFixture> {
  // ssh2 разбирает PKCS#1; для PKCS#8 ('-----BEGIN PRIVATE KEY-----') parseKey даёт
  // «Unsupported key format», а generateKeyPairSync по умолчанию отдаёт именно pkcs8.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  // ssh2 понимает PKCS#8 PEM; отпечаток считаем с wire-блоба, который вернёт parseKey.
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  const publicBlob = (parsed as { getPublicSSH?(): Buffer }).getPublicSSH?.();
  if (!publicBlob) throw new Error('fixture: cannot read public key blob');

  const fixture: SshFixture = {
    port: 0,
    fingerprint: hostKeyFingerprint(publicBlob),
    authAttempts: 0,
    execRequests: [],
    closedConnections: 0,
    close: async () => undefined,
  };

  const behavior = options.behavior ?? 'normal';
  const server = new Server({ hostKeys: [Buffer.from(privateKey)] }, (client: Connection) => {
    client.on('authentication', (ctx) => {
      fixture.authAttempts += 1;
      if (behavior === 'hang-auth') return; // не отвечаем — readyTimeout на стороне клиента
      if (behavior === 'reject-auth' || ctx.method !== 'password' || ctx.password !== options.password) {
        ctx.reject(['password']);
        return;
      }
      ctx.accept();
    });
    client.on('session', (accept) => {
      if (behavior === 'hang-exec') return; // канал не открываем: команда висит
      const session = accept();
      session.on('exec', (execAccept, _reject, info) => {
        const stream: ClientChannel = execAccept();
        fixture.execRequests.push(info.command);
        if (behavior === 'reset-after-auth') {
          stream.close();
          client.end();
          return;
        }
        stream.stderr.write(options.exec?.stderr ?? '');
        stream.write(options.exec?.stdout ?? '');
        stream.exit(options.exec?.code ?? 0);
        stream.end();
      });
    });
    client.on('close', () => {
      fixture.closedConnections += 1;
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fixture.port = (server.address() as AddressInfo).port;
  fixture.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  return fixture;
}
```

- [x] **Step 7: Написать тесты адаптера** (реальный транспорт, без моков)

```ts
import { CredentialCryptoService } from '../credentials/credential-crypto.service';
import { NodeSshRunner } from './node-ssh.runner';
import { SshFailure, type SshSession } from './ssh-runner';
import { startSshFixture } from './testing/ssh-server-fixture';
import type { AppConfig } from '../../../config/app.config';
import { generateKeyPairSync } from 'node:crypto';

const PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

function runnerCfg(overrides: Partial<AppConfig['ssh']> = {}): AppConfig {
  return {
    ssh: {
      connectTimeoutMs: 1500,
      commandTimeoutMs: 1500,
      installTimeoutMs: 3000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22],
      allowLoopback: true,
      ...overrides,
    },
    crypto: { activeKey: { id: 'k1', key: Buffer.alloc(32, 7) }, oldKeys: new Map(), ephemeralServerKey: false },
  } as AppConfig;
}

function session(port: number, fingerprint: string | null, secret = 'sup3rsecret'): SshSession {
  return {
    host: '127.0.0.1',
    address: '127.0.0.1',
    port,
    username: 'deploy',
    authType: 'PASSWORD',
    secret,
    expectedHostKeyFingerprint: fingerprint,
  };
}

const settle = async (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('NodeSshRunner (real ssh2 server)', () => {
  test('выполняет команду и возвращает stdout/stderr/code', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      exec: { stdout: '27.3.1\n', stderr: 'warn\n', code: 0 },
    });
    try {
      const res = await new NodeSshRunner(runnerCfg()).exec(
        session(fx.port, fx.fingerprint),
        "docker version --format '{{.Server.Version}}'",
        3000,
      );
      expect(res.stdout.trim()).toBe('27.3.1');
      expect(res.stderr.trim()).toBe('warn');
      expect(res.code).toBe(0);
      expect(fx.execRequests).toEqual(["docker version --format '{{.Server.Version}}'"]);
    } finally {
      await fx.close();
    }
  });

  test('probe НЕ отправляет креденшелы: аутентификация на сервере не началась', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret' });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(runner.exec(session(fx.port, null), 'echo hi', 3000)).rejects.toMatchObject({
        code: 'HOST_KEY_NOT_TRUSTED',
        observedHostKeyFingerprint: fx.fingerprint,
      });
      expect(fx.authAttempts).toBe(0);
      // Секрет не попал ни в одно наблюдение сервера.
      expect(fx.execRequests.join()).not.toContain('sup3rsecret');
    } finally {
      await fx.close();
    }
  });

  test('несовпадение пина → HOST_KEY_MISMATCH, сервер не увидел пароля', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret' });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(
        runner.exec(session(fx.port, 'SHA256:' + 'A'.repeat(43)), 'echo hi', 3000),
      ).rejects.toMatchObject({
        code: 'HOST_KEY_MISMATCH',
        observedHostKeyFingerprint: fx.fingerprint,
      });
      expect(fx.authAttempts).toBe(0);
    } finally {
      await fx.close();
    }
  });

  test('после принятия отпечатка подключение проходит', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret', exec: { stdout: 'ok' } });
    try {
      const res = await new NodeSshRunner(runnerCfg()).exec(session(fx.port, fx.fingerprint), 'echo ok', 3000);
      expect(res.stdout).toBe('ok');
      expect(fx.authAttempts).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('отказ аутентификации → AUTH_FAILED', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret', behavior: 'reject-auth' });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(runner.exec(session(fx.port, fx.fingerprint), 'echo hi', 3000)).rejects.toMatchObject({
        code: 'AUTH_FAILED',
      });
    } finally {
      await fx.close();
    }
  });

  test('зависшее рукопожатие → TIMEOUT по connectTimeoutMs и соединение закрыто', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret', behavior: 'hang-auth' });
    try {
      const runner = new NodeSshRunner(runnerCfg({ connectTimeoutMs: 400 }));
      const started = Date.now();
      await expect(runner.exec(session(fx.port, fx.fingerprint), 'echo hi', 5000)).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
      expect(Date.now() - started).toBeLessThan(3000);
      await settle();
      expect(fx.closedConnections).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('зависшая команда → TIMEOUT по commandTimeoutMs, dispose observed', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret', behavior: 'hang-exec' });
    try {
      const runner = new NodeSshRunner(runnerCfg({ commandTimeoutMs: 400 }));
      await expect(runner.exec(session(fx.port, fx.fingerprint), 'sleep 60', 400)).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
      await settle();
      expect(fx.closedConnections).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('key-based аутентификация использует PEM как privateKey', async () => {
    const fx = await startSshFixture({ password: 'unused' });
    const runner = new NodeSshRunner(runnerCfg());
    try {
      await expect(
        runner.exec(
          { ...session(fx.port, fx.fingerprint, PEM), authType: 'KEY' },
          'echo hi',
          1500,
        ),
      ).rejects.toBeInstanceOf(SshFailure);
      // Сервер отклонил password-метод; сам факт, что дошёл до аутентификации, означает: PEM принят ssh2.
      expect(fx.authAttempts).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });
});
```

Тайминг-тесты намеренно с запасом (`< 3000` при `connectTimeoutMs: 400`): на медленной машине они не должны становиться flaky, а смысл проверки — «не висит до бесконечности и соединение закрыто», а не точная миллисекунда.

Правки по фактическим прогонам (все три — неверные предположения черновика, пойманные тестами, а не вкусовщина):

1. **Формат ключа.** `utils.parseKey` не читает PKCS#8 (`Unsupported key format`), а `generateKeyPairSync` по умолчанию отдаёт именно pkcs8 — фикстура падала ещё до слушателя. Ключ генерируем в `pkcs1`. Заодно проверено: pkcs1-RSA, ec-sec1 (для supported-кривой) и OpenSSH-формат ssh2 читает, pkcs8 и DSA — нет; зашифрованный OpenSSH-ключ даёт `Encrypted private OpenSSH key detected, but no passphrase given`. Это и есть реальный критерий Task 8: ключ, который ssh2 не может загрузить, подключению не пригоден, поэтому `parseKey` — честный оракул, а не «дополнительная» проверка.
2. **`Server` из ssh2 — не `net.Server`.** В типах он объявлен как `extends NetServer`, но в рантайме это обёртка над внутренним `net.Server`: `closeAllConnections()` отсутствует (TypeError в `fx.close()`), а открытые после hang-сценариев сокеты вешают jest-воркер (первый прогон не завершился вообще). Фикстура сама держит `Set<Connection>` и вызывает `client.end()` в `close()`.
3. **Клиент, отвергнувший host key, порождает `'error'` на серверном соединении** (`KEY_EXCHANGE_FAILED`, code 3). Без слушателя Node считает его необработанным и валит воркер. Это не «ошибка фикстуры», а искомое доказательство: обрыв произошёл на KEX, то есть до аутентификации, — поэтому тесты и видят `authAttempts === 0`. В фикстуре добавлен `client.on('error', () => undefined)` с комментарием.
4. У ветки `reset-after-auth` не было теста — удалена (мёртвый код). Вместо неё добавлены тесты на реальный `REFUSED` (закрытый порт) и на ненулевой код возврата команды; отпечаток из `getPublicSSH()` совпал с тем, что посчитал клиент (проверено прогоном, а не на веру).

- [x] **Step 8: Зелёные тесты, сборка, линт**

Run: `npx jest src/modules/servers/ssh/ && npm run build && npx eslint src/modules/servers/ssh` — Expected: PASS. Если `getPublicSSH()` отсутствует на объекте из `parseKey` — считать это сигналом, что фикстура считает отпечаток иначе, и брать его из события сервера (ssh2 отдаёт ключ в `info.key` на соединении), а не менять определение `hostKeyFingerprint`.

- [x] **Step 9: Коммит**

```bash
git add app/backend/package.json app/backend/package-lock.json app/backend/src/modules/servers/ssh/
git commit -m "feat(backend): ssh runner with host key pinning and real adapter tests"
```

---

### Task 7: Команды агента: генератор, парсер протокола, shell-песочница

**Files:**
- Create: `src/modules/servers/agent/shell-quote.ts`
- Create: `src/modules/servers/agent/agent-script.ts`
- Test: `src/modules/servers/agent/agent-script.spec.ts` (парсер и генератор), `src/modules/servers/agent/agent-script.sandbox.spec.ts` (исполнение на реальном `/bin/sh`)

**Interfaces:**
- Produces: `shq`, `priv`, `AgentPaths`, `PROD_AGENT_PATHS`, `AGENT_UNIT`, `buildDockerVersionCommand`, `buildAgentReadCommand(paths?)`, `buildInstallScript({…, paths?})`, `parseAgentState`, `agentStatusOf` (→ `{ status, errorCode }`), `AgentRawState`, `AgentUnitState`.

Протокол чтения (шесть ключей, отсутствующие значения — явно `-`): `SD` (есть ли `systemctl`), `MF` (есть ли файл манифеста), `JSON` (сам манифест), `UNIT` (состояние юнита), `HB` (mtime-метка heartbeat в epoch), `NOW` (epoch хоста). Именно это и разводит `NOT_INSTALLED` и `FAILED`, которые ревью смешало (пункт 6): «файла нет» и «файл есть, но не читается» и «systemd нет» — три разных факта, а не один `null`.

- [x] **Step 1: Написать падающий тест генератора и парсера**

```ts
import { priv, shq } from './shell-quote';
import {
  AGENT_UNIT,
  PROD_AGENT_PATHS,
  agentStatusOf,
  buildAgentReadCommand,
  buildDockerVersionCommand,
  buildInstallScript,
  parseAgentState,
  type AgentRawState,
} from './agent-script';

const WS = '01912345-6789-7abc-aef0-1234567890ab';
const SRV = '01912345-6789-7abc-aef0-1234567890ac';
const expected = { workspaceId: WS, serverId: SRV };
const manifest = `{"version":"0.1.0","workspaceId":"${WS}","serverId":"${SRV}"}`;

const out = (fields: Partial<Record<'SD' | 'MF' | 'JSON' | 'UNIT' | 'HB' | 'NOW', string>>): string =>
  ['SD', 'MF', 'JSON', 'UNIT', 'HB', 'NOW']
    .map((k) => `${k}=${fields[k] ?? '-'}`)
    .join('\n');

describe('shell quoting', () => {
  test('shq экранирует одинарную кавычку POSIX-идиомой', () => {
    expect(shq('plain')).toBe("'plain'");
    expect(shq("it's")).toBe("'it'\\''s'");
    expect(shq('a; rm -rf /')).toBe("'a; rm -rf /'");
    expect(shq('$(id)`id`')).toBe("'$(id)`id`'");
  });

  test('priv оборачивает только непривилегированного пользователя', () => {
    expect(priv('echo hi', true)).toBe('echo hi');
    expect(priv('echo hi', false)).toBe("sudo -n sh -lc 'echo hi'");
  });
});

describe('install script', () => {
  const script = buildInstallScript({ workspaceId: WS, serverId: SRV, version: '0.1.0', root: true });

  test('префлайт различает docker-нет-CLI, отказ доступа и молчащий сокет', () => {
    expect(script).toContain('BIOS_ERR_DOCKER >&2; exit 42');
    expect(script).toContain('BIOS_ERR_DOCKER_PERM >&2; exit 45');
    expect(script).toContain('BIOS_ERR_DOCKER_SOCKET >&2; exit 46');
    expect(script).toContain('BIOS_ERR_SYSTEMD >&2; exit 43');
  });

  test('манифест с идентификаторами, юнит с автоперезапуском', () => {
    expect(script).toContain(`${PROD_AGENT_PATHS.dir}/agent.json`);
    expect(script).toContain(`"serverId":"${SRV}"`);
    expect(script).toContain(`systemctl enable ${AGENT_UNIT}`);
    expect(script).toContain('Restart=always');
  });

  test('root — без sudo, непривилегированный — каждый опасный шаг в sudo -n', () => {
    const sudo = buildInstallScript({ workspaceId: WS, serverId: SRV, version: '0.1.0', root: false });
    expect(script).not.toContain('sudo -n');
    expect(sudo).toContain('sudo -n');
  });

  test('payload с кавычкой и command substitution попадает в команду экранированным', () => {
    const evil = buildInstallScript({
      workspaceId: WS,
      serverId: "x'$(touch /tmp/pwned)",
      version: '0.1.0',
      root: true,
    });
    // Точная escaped-последовательность: shq разрывает подстроку вставкой '\'' (ревью №9).
    // Проверяем кусок ВНУТРИ json-значения: перед "serverId" в мантифесте стоит
    // запятая, а не кавычка, поэтому ожидаемая подстрока начинается с '"serverId"'.
    expect(evil).toContain(`"serverId":"x'\\''$(touch /tmp/pwned)"`);
    expect(evil).not.toContain(`"serverId":"x'$(touch /tmp/pwned)"`);
  });
});

describe('read command and parser', () => {
  test('команда чтения печатает все шесть ключей', () => {
    const cmd = buildAgentReadCommand();
    for (const key of ['SD=', 'MF=', 'JSON=', 'UNIT=', 'HB=', 'NOW=']) {
      expect(cmd).toContain(`printf '${key}%s\\n'`);
    }
    expect(cmd).toContain(`systemctl is-active ${AGENT_UNIT}`);
  });

  test('docker version command — ровно одна команда', () => {
    expect(buildDockerVersionCommand()).toBe("docker version --format '{{.Server.Version}}'");
  });

  test('полный протокол разбирается по полям', () => {
    expect(parseAgentState(out({ SD: 'ok', MF: 'present', JSON: manifest, UNIT: 'active', HB: '1000', NOW: '1030' }))).toEqual(
      {
        protocolOk: true,
        systemd: 'ok',
        manifestFile: 'present',
        manifest: { version: '0.1.0', workspaceId: WS, serverId: SRV },
        manifestParseError: false,
        unit: 'active',
        heartbeatSec: 1000,
        nowSec: 1030,
      } satisfies AgentRawState,
    );
  });

  test('битый JSON и мусор вместо протокола различимы', () => {
    const broken = parseAgentState(out({ SD: 'ok', MF: 'present', JSON: '{not json', UNIT: 'active', HB: '1', NOW: '2' }));
    expect(broken.manifest).toBeNull();
    expect(broken.manifestParseError).toBe(true);

    const garbage = parseAgentState('nothing useful here');
    expect(garbage.protocolOk).toBe(false);
    expect(garbage.systemd).toBe('unreadable');
  });

  test('машина состояний соответствует таблице плана', () => {
    const stale = 60;
    const run = (fields: Parameters<typeof out>[0]) => agentStatusOf(parseAgentState(out(fields)), stale, expected);

    expect(run({ SD: 'ok', MF: 'absent', UNIT: 'no-unit', NOW: '10' })).toEqual({ status: 'NOT_INSTALLED', errorCode: null });
    expect(run({ SD: 'missing', MF: 'absent', UNIT: 'no-unit', NOW: '10' })).toEqual({ status: 'NOT_INSTALLED', errorCode: null });
    expect(run({ SD: 'ok', MF: 'absent', UNIT: 'active', NOW: '10' })).toEqual({
      status: 'FAILED',
      errorCode: 'AGENT_MANIFEST_MISSING',
    });
    expect(run({ SD: 'ok', MF: 'present', JSON: manifest, UNIT: 'active', HB: '1000', NOW: '1061' })).toEqual({
      status: 'STALE',
      errorCode: 'AGENT_HEARTBEAT_STALE',
    });
    expect(run({ SD: 'ok', MF: 'present', JSON: manifest, UNIT: 'active', NOW: '1061' })).toEqual({
      status: 'STALE',
      errorCode: 'AGENT_HEARTBEAT_STALE',
    });
    expect(run({ SD: 'ok', MF: 'present', JSON: manifest, UNIT: 'failed', HB: '1000', NOW: '1030' })).toEqual({
      status: 'FAILED',
      errorCode: 'AGENT_NOT_RUNNING',
    });
    expect(run({ SD: 'ok', MF: 'present', JSON: '{bad', UNIT: 'active', HB: '1000', NOW: '1030' })).toEqual({
      status: 'FAILED',
      errorCode: 'MANIFEST_INVALID',
    });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: `{"version":"0.1.0","workspaceId":"${WS}","serverId":"other"}`,
        UNIT: 'active',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'FAILED', errorCode: 'IDENTITY_MISMATCH' });
    expect(run({ SD: 'missing', MF: 'present', JSON: manifest, UNIT: 'no-unit', HB: '1000', NOW: '1030' })).toEqual({
      status: 'FAILED',
      errorCode: 'SYSTEMD_MISSING',
    });
    expect(run({ SD: 'ok', MF: 'present', JSON: manifest, UNIT: 'active', HB: '1000', NOW: '1030' })).toEqual({
      status: 'ACTIVE',
      errorCode: null,
    });
    const unreadable = agentStatusOf(parseAgentState('garbage'), stale, expected);
    expect(unreadable).toEqual({ status: 'FAILED', errorCode: 'READ_FAILED' });
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/agent/` — Expected: FAIL.

- [x] **Step 3: Реализовать `shell-quote.ts`**

```ts
/** POSIX-экранирование одного аргумента: одинарная кавычка закрывается, экранируется, открывается. */
export function shq(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Непривилегированный пользователь получает каждый опасный шаг через sudo -n. */
export function priv(command: string, root: boolean): string {
  return root ? command : `sudo -n sh -lc ${shq(command)}`;
}
```

- [x] **Step 4: Реализовать `agent-script.ts`**

```ts
import { priv, shq } from './shell-quote';
import type { SshErrorCode } from '../ssh/ssh-runner';

export const AGENT_UNIT = 'bios-agent.service';

export interface AgentPaths {
  dir: string;
  unitPath: string;
  manifestPath: string;
  heartbeatPath: string;
  scriptPath: string;
}

export const PROD_AGENT_PATHS: AgentPaths = (() => {
  const dir = '/opt/bios-agent';
  return {
    dir,
    unitPath: `/etc/systemd/system/${AGENT_UNIT}`,
    manifestPath: `${dir}/agent.json`,
    heartbeatPath: `${dir}/heartbeat`,
    scriptPath: `${dir}/agent.sh`,
  };
})();

export type AgentUnitState = 'active' | 'inactive' | 'failed' | 'no-unit' | 'no-systemd' | 'unknown';
export type AgentStatus = 'NOT_INSTALLED' | 'FAILED' | 'STALE' | 'ACTIVE';

export interface AgentManifest {
  version: string;
  workspaceId: string;
  serverId: string;
}

export interface AgentRawState {
  protocolOk: boolean;
  systemd: 'ok' | 'missing' | 'unreadable';
  manifestFile: 'present' | 'absent' | 'unreadable';
  manifest: AgentManifest | null;
  manifestParseError: boolean;
  unit: AgentUnitState;
  heartbeatSec: number | null;
  nowSec: number | null;
}

const UNIT_STATES = new Set<AgentUnitState>(['active', 'inactive', 'failed', 'no-unit', 'no-systemd', 'unknown']);

/** agent.sh: пишет heartbeat, пока Docker-сокет отвечает. Одинарных кавычек в теле нет. */
function agentScriptBody(paths: AgentPaths): string {
  return [
    '#!/bin/sh',
    'while :',
    'do',
    '  if docker info >/dev/null 2>&1',
    '  then',
    `    date -u +%s > ${shq(paths.heartbeatPath)}`,
    '  fi',
    '  sleep 15',
    'done',
  ].join('\n');
}

function unitBody(paths: AgentPaths): string {
  return [
    '[Unit]',
    'Description=Bios host agent',
    'After=docker.service',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=/bin/sh ${paths.scriptPath}`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n');
}

export function buildDockerVersionCommand(): string {
  return "docker version --format '{{.Server.Version}}'";
}

export function buildAgentReadCommand(paths: AgentPaths = PROD_AGENT_PATHS): string {
  const manifest = shq(paths.manifestPath);
  const heartbeat = shq(paths.heartbeatPath);
  return [
    'set -u',
    `printf 'SD=%s\\n' "$(command -v systemctl >/dev/null 2>&1 && printf ok || printf missing)"`,
    `printf 'MF=%s\\n' "$(if [ -f ${manifest} ]; then printf present; else printf absent; fi)"`,
    `printf 'JSON=%s\\n' "$(cat ${manifest} 2>/dev/null || printf -)"`,
    `printf 'UNIT=%s\\n' "$(systemctl is-active ${AGENT_UNIT} 2>/dev/null || printf no-unit)"`,
    `printf 'HB=%s\\n' "$(cat ${heartbeat} 2>/dev/null || printf -)"`,
    `printf 'NOW=%s\\n' "$(date -u +%s)"`,
  ].join('\n');
}

export function buildInstallScript(input: {
  workspaceId: string;
  serverId: string;
  version: string;
  root: boolean;
  paths?: AgentPaths;
}): string {
  const paths = input.paths ?? PROD_AGENT_PATHS;
  const { root } = input;
  // Манифест — статический JSON; installedAt живёт в БД панели, поэтому удалённая дата
  // и её перекос не влияют на «когда установили».
  const manifest = JSON.stringify({
    version: input.version,
    workspaceId: input.workspaceId,
    serverId: input.serverId,
  });
  const writeFile = (path: string, content: string, mode: string): string =>
    priv(`printf '%s\\n' ${shq(content)} > ${shq(path)} && chmod ${shq(mode)} ${shq(path)}`, root);

  const preflight = [
    'command -v docker >/dev/null 2>&1 || { echo BIOS_ERR_DOCKER >&2; exit 42; }',
    'docker info >/dev/null 2>&1 || {',
    '  err=$(docker info 2>&1 || true)',
    '  case "$err" in',
    '    *"permission denied"*) echo BIOS_ERR_DOCKER_PERM >&2; exit 45 ;;',
    '    *"Cannot connect to the Docker daemon"*) echo BIOS_ERR_DOCKER_SOCKET >&2; exit 46 ;;',
    '    *) echo BIOS_ERR_DOCKER >&2; exit 42 ;;',
    '  esac',
    '}',
    'command -v systemctl >/dev/null 2>&1 || { echo BIOS_ERR_SYSTEMD >&2; exit 43; }',
  ];

  return [
    'set -eu',
    ...preflight,
    priv(`mkdir -p ${shq(paths.dir)} && chmod 0755 ${shq(paths.dir)}`, root),
    writeFile(paths.manifestPath, manifest, '0644'),
    writeFile(paths.scriptPath, agentScriptBody(paths), '0755'),
    writeFile(paths.unitPath, unitBody(paths), '0644'),
    priv(
      `systemctl daemon-reload && systemctl enable ${AGENT_UNIT} && systemctl restart ${AGENT_UNIT}`,
      root,
    ),
  ].join('\n');
}

export function parseAgentState(stdout: string): AgentRawState {
  const field = (key: string): string | null => {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(stdout);
    return m ? m[1].trim() : null;
  };
  const toNumber = (value: string | null): number | null =>
    value !== null && /^\d+$/.test(value) ? Number(value) : null;

  const sd = field('SD');
  const mf = field('MF');
  const unit = field('UNIT');
  const now = toNumber(field('NOW'));
  const json = field('JSON');
  const hb = field('HB');

  // Нет хотя бы одного обязательного ключа — протокол не соблюден, выводимое состояние неизвестно.
  if (sd === null || mf === null || unit === null || now === null) {
    return {
      protocolOk: false,
      systemd: 'unreadable',
      manifestFile: 'unreadable',
      manifest: null,
      manifestParseError: false,
      unit: 'unknown',
      heartbeatSec: null,
      nowSec: null,
    };
  }

  let manifest: AgentManifest | null = null;
  let manifestParseError = false;
  if (json !== null && json !== '-' && mf === 'present') {
    try {
      const parsed: unknown = JSON.parse(json);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as AgentManifest).version === 'string' &&
        typeof (parsed as AgentManifest).workspaceId === 'string' &&
        typeof (parsed as AgentManifest).serverId === 'string'
      ) {
        manifest = parsed as AgentManifest;
      } else {
        manifestParseError = true;
      }
    } catch {
      manifestParseError = true;
    }
  }

  return {
    protocolOk: true,
    systemd: sd === 'ok' ? 'ok' : sd === 'missing' ? 'missing' : 'unreadable',
    manifestFile: mf === 'present' ? 'present' : mf === 'absent' ? 'absent' : 'unreadable',
    manifest,
    manifestParseError,
    unit: unit !== null && UNIT_STATES.has(unit as AgentUnitState)
      ? (unit as AgentUnitState)
      : unit === 'no-unit'
        ? 'no-unit'
        : 'unknown',
    heartbeatSec: hb === null || hb === '-' ? null : toNumber(hb),
    nowSec: now,
  };
}

export function agentStatusOf(
  state: AgentRawState,
  staleSec: number,
  expected: { workspaceId: string; serverId: string },
): { status: AgentStatus; errorCode: SshErrorCode | null } {
  if (!state.protocolOk) return { status: 'FAILED', errorCode: 'READ_FAILED' };
  if (state.systemd === 'unreadable') return { status: 'FAILED', errorCode: 'READ_FAILED' };

  if (state.manifestFile === 'absent') {
    // Юнит запущен, а манифеста нет — установка битая; иначе действительно не установлено.
    return state.unit === 'active'
      ? { status: 'FAILED', errorCode: 'AGENT_MANIFEST_MISSING' }
      : { status: 'NOT_INSTALLED', errorCode: null };
  }

  if (state.manifestParseError || state.manifest === null) {
    return { status: 'FAILED', errorCode: 'MANIFEST_INVALID' };
  }
  if (
    state.manifest.workspaceId !== expected.workspaceId ||
    state.manifest.serverId !== expected.serverId
  ) {
    return { status: 'FAILED', errorCode: 'IDENTITY_MISMATCH' };
  }
  if (state.systemd === 'missing') return { status: 'FAILED', errorCode: 'SYSTEMD_MISSING' };
  if (state.unit !== 'active') return { status: 'FAILED', errorCode: 'AGENT_NOT_RUNNING' };
  if (state.heartbeatSec === null) return { status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' };
  if (state.nowSec !== null && state.nowSec - state.heartbeatSec > staleSec) {
    return { status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' };
  }
  return { status: 'ACTIVE', errorCode: null };
}
```

Правки по прогону Task 7: (1) пути идут через `shq()` и в команде чтения тоже — инвариант «в удалённую shell-строку попадает только экранированное» не должен держаться на предположении, что пути аккуратные (в песочнице они временные и могут содержать пробел); (2) строка `NOW` в черновике была `date | awk -v d=$dir`, где `d` не использовался — убрано, остался один `printf`; (3) в `agentScriptBody` путь heartbeat тоже экранирован, иначе сгенерированный `agent.sh` падал бы на пути с пробелом; (4) `replaceAll(PROD_AGENT_PATHS.manifestPath, …)` из первого sandbox-теста не нужен (команда чтения уже строится по `paths`) — удалён, как и предусматривал шаг; (5) добавлен кейс префлайта на `exit 46` (молчащий сокет) и удаление `/tmp/bios-sandbox-pwned` перед тестом, чтобы прошлый артефакт не давал ложного провала.

- [x] **Step 5: Написать и прогнать тест на реальном `/bin/sh`** (сильнее, чем сравнение строк: доказывает, что payload не исполняется)

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInstallScript, parseAgentState, PROD_AGENT_PATHS, type AgentPaths } from './agent-script';

const WS = '01912345-6789-7abc-aef0-1234567890ab';
const SRV = "x'$(touch /tmp/bios-sandbox-pwned)";

function stubPaths(bin: string): void {
  for (const name of ['docker', 'systemctl']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
}

describe('install script in a real shell', () => {
  test('payload с кавычкой и substitution ложится в файл литералом и не исполняется', () => {
    const root = mkdtempSync(join(tmpdir(), 'bios-agent-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    stubPaths(bin);

    const paths: AgentPaths = {
      dir: join(root, 'opt'),
      unitPath: join(root, 'etc', 'bios-agent.service'),
      manifestPath: join(root, 'opt', 'agent.json'),
      heartbeatPath: join(root, 'opt', 'heartbeat'),
      scriptPath: join(root, 'opt', 'agent.sh'),
    };
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(join(root, 'etc'), { recursive: true });

    const script = buildInstallScript({
      workspaceId: WS,
      serverId: SRV,
      version: '0.1.0',
      root: true,
      paths,
    });

    expect(() =>
      execFileSync('/bin/sh', ['-c', script], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: 'pipe',
      }),
    ).not.toThrow();

    const written = JSON.parse(readFileSync(paths.manifestPath, 'utf8'));
    expect(written.serverId).toBe(SRV); // ровно тот же мусорный payload, ставший данными
    expect(written.workspaceId).toBe(WS);
    expect(written.version).toBe('0.1.0');
    expect(existsSync('/tmp/bios-sandbox-pwned')).toBe(false);
    expect(readFileSync(paths.scriptPath, 'utf8')).toContain('while :');
    expect(readFileSync(paths.unitPath, 'utf8')).toContain('Restart=always');

    // Прочитать состояние с того же «хоста»: манифест чужой → IDENTITY_MISMATCH.
    const readScript = buildAgentReadCommand(paths).replaceAll(
      PROD_AGENT_PATHS.manifestPath,
      paths.manifestPath,
    );
    const stdout = execFileSync('/bin/sh', ['-c', readScript], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    expect(parseAgentState(stdout).manifest?.serverId).toBe(SRV);
  });

  test('префлайт падает с 43, когда systemctl нет, и с 45 при отказе доступа к сокету', () => {
    const root = mkdtempSync(join(tmpdir(), 'bios-agent-preflight-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    mkdirSync(join(root, 'opt'), { recursive: true });
    const paths: AgentPaths = {
      dir: join(root, 'opt'),
      unitPath: join(root, 'etc.service'),
      manifestPath: join(root, 'opt', 'agent.json'),
      heartbeatPath: join(root, 'opt', 'heartbeat'),
      scriptPath: join(root, 'opt', 'agent.sh'),
    };

    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const script = buildInstallScript({ workspaceId: WS, serverId: 'srv', version: '0.1.0', root: true, paths });
    let code: number | undefined;
    let stderr = '';
    try {
      execFileSync('/bin/sh', ['-c', script], {
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        stdio: 'pipe',
      });
    } catch (err) {
      code = (err as { status?: number }).status;
      stderr = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(code).toBe(43);
    expect(stderr).toContain('BIOS_ERR_SYSTEMD');

    writeFileSync(
      join(bin, 'systemctl'),
      '#!/bin/sh\nexit 0\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'docker'),
      '#!/bin/sh\nif [ "$1" = "info" ]; then echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1; fi\nexit 0\n',
      { mode: 0o755 },
    );
    try {
      execFileSync('/bin/sh', ['-c', script], {
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        stdio: 'pipe',
      });
      code = undefined;
    } catch (err) {
      code = (err as { status?: number }).status;
      stderr = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(code).toBe(45);
    expect(stderr).toContain('BIOS_ERR_DOCKER_PERM');
  });
});
```

Замечание для исполнителя: `buildAgentReadCommand(paths)` уже печатает пути из `paths`, поэтому `replaceAll` в первом тесте — только страховка от того, что `MF`/`JSON` используют `PROD_AGENT_PATHS`. Если после реализации тест проходит без `replaceAll` — убери его (мёртвый код в тесте хуже дублирования).

- [x] **Step 6: Зелёные тесты, сборка, линт**

Run: `npx jest src/modules/servers/agent/ && npm run build && npx prettier --check "src/modules/servers/agent/**"` — Expected: PASS.

- [x] **Step 7: Коммит**

```bash
git add app/backend/src/modules/servers/agent/
git commit -m "feat(backend): add agent command protocol with shell sandbox tests"
```

---

### Task 8: `requireMembership` + CRUD серверов

**Files:**
- Modify: `src/modules/workspaces/workspaces.service.ts` (приватный `requireRole` → публичный `requireMembership`)
- Test: `src/modules/workspaces/workspaces.spec.ts` (дополнить)
- Create: `src/modules/servers/servers.service.ts`
- Modify: `src/modules/servers/servers.controller.ts` (роуты 1–3), `servers.module.ts`
- Test: `src/modules/servers/servers.spec.ts` (БД `bios_test_servers`)

**Interfaces:**
- Consumes: `PrismaService`, `WorkspacesService.requireMembership`, `CredentialCryptoService` (Task 3), DTO (Task 4), `SSH_RUNNER` (Task 5), `AppConfig` (Task 2), `utils.parseKey` (ssh2, Task 6).
- Produces: `ServersService.create/findAll/findOne/loadForSsh`, `ServerResponse`, `toServerResponse`, `MEMBER_ROLES`, `OWNER_ONLY_ROLES`, тестовый каркас `describe('servers module')` с `testAppConfig()`, `dtoFor()`, `extraUser()`, `inviteAndAccept()` — переиспользуется в Task 9 и Task 10.

- [x] **Step 1: Публичный `requireMembership`**

Заменить приватный `requireRole` (единственный вызов — в `invite`):

```ts
/** Нет membership → 404 (неотличимо). Роль вне списка → 403. */
async requireMembership(
  userId: string,
  workspaceId: string,
  roles?: WorkspaceRole[],
): Promise<WorkspaceRole> {
  const membership = await this.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) throw new NotFoundException();
  if (roles && !roles.includes(membership.role)) throw new ForbiddenException();
  return membership.role;
}
```

Дополнить `workspaces.spec.ts`:

```ts
test('requireMembership: роль, 404 для чужих, 403 для не-OWNER', async () => {
  const owner = await registerUser();
  const outsider = await registerUser();
  const ws = await workspaces.create(owner.id, { name: 'roles' });

  await expect(workspaces.requireMembership(owner.id, ws.id)).resolves.toBe('OWNER');
  await expect(workspaces.requireMembership(outsider.id, ws.id)).rejects.toThrow(NotFoundException);
  await expect(
    workspaces.requireMembership(owner.id, '01912345-6789-7abc-aef0-1234567890ab', [WorkspaceRole.MEMBER]),
  ).rejects.toThrow(NotFoundException);

  const invitation = await workspaces.invite(owner.id, ws.id, 'rolemember@example.com');
  const member = await users.create({
    username: 'rolemember',
    email: 'rolemember@example.com',
    password: 'secret123',
  });
  await workspaces.accept(member.id, ws.id, invitation.token);
  await expect(
    workspaces.requireMembership(member.id, ws.id, [WorkspaceRole.OWNER]),
  ).rejects.toThrow(ForbiddenException);
  await expect(
    workspaces.requireMembership(member.id, ws.id, [WorkspaceRole.MEMBER]),
  ).resolves.toBe('MEMBER');
});
```

Run: `npx jest src/modules/workspaces/` — Expected: PASS.

- [x] **Step 2: Написать падающие CRUD-тесты**

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { AppConfig } from '../../config/app.config';
import type { CreateServerDto } from './dto/create-server.dto';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { FakeSshRunner } from './ssh/fake-ssh.runner';
import { MEMBER_ROLES, ServersService } from './servers.service';

const TEST_DB_URL = 'postgresql://sabir@localhost:5432/bios_test_servers?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const REAL_PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

export function testAppConfig(overrides: Partial<AppConfig['ssh']> = {}): AppConfig {
  return {
    ssh: {
      connectTimeoutMs: 1500,
      commandTimeoutMs: 1500,
      installTimeoutMs: 3000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22, 2202],
      allowLoopback: true,
      ...overrides,
    },
    crypto: {
      activeKey: { id: 'k1', key: Buffer.alloc(32, 7) },
      oldKeys: new Map([['k0', Buffer.alloc(32, 6)]]),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

describe('servers module', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let credentials: CredentialCryptoService;
  let ssh: FakeSshRunner;
  let servers: ServersService;
  let ownerId: string;
  let workspaceId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(prisma, new TokensService(prisma), new SessionsService(prisma));
    workspaces = new WorkspacesService(prisma);
    credentials = new CredentialCryptoService(testAppConfig());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ssh = new FakeSshRunner();
    servers = new ServersService(prisma, workspaces, credentials, ssh, testAppConfig());
    ownerId = (await users.create({
      username: `srvowner${n}`,
      email: `srvowner${n}@example.com`,
      password: 'secret123',
    })).id;
    workspaceId = (await workspaces.create(ownerId, { name: `srv-ws-${n}` })).id;
  });

  afterEach(async () => {
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dtoFor(overrides: Partial<CreateServerDto> = {}): CreateServerDto {
    return {
      name: 'prod-1',
      host: '203.0.113.10',
      port: 22,
      sshUsername: 'deploy',
      authType: 'PASSWORD',
      sshPassword: 'sup3rsecret',
      ...overrides,
    } as CreateServerDto;
  }

  async function extraUser(username: string): Promise<string> {
    return (
      await users.create({ username, email: `${username}@example.com`, password: 'secret123' })
    ).id;
  }

  async function inviteAndAccept(email: string): Promise<string> {
    const invitation = await workspaces.invite(ownerId, workspaceId, email);
    const user = await users.create({ username: email.split('@')[0], email, password: 'secret123' });
    await workspaces.accept(user.id, workspaceId, invitation.token);
    return user.id;
  }

  describe('CRUD', () => {
    test('create: cipher с активным kid, статус PENDING, без пина и без секрета в ответе', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      expect(created).toMatchObject({
        status: 'PENDING',
        authType: 'PASSWORD',
        hostKeyFingerprint: null,
        workspaceId,
      });
      expect(Object.keys(created)).not.toContain('secretCipher');
      expect(JSON.stringify(created)).not.toContain('sup3rsecret');

      const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.secretCipher.startsWith('v1.k1.')).toBe(true);
      expect(row.secretCipher).not.toContain('sup3rsecret');
      expect(credentials.decrypt(row.secretCipher)).toBe('sup3rsecret');
      expect(row.hostKeyFingerprint).toBeNull();
      // создание не ходит в сеть
      expect(ssh.commands).toHaveLength(0);
    });

    test('create с PEM проходит структурную проверку ключа (не только regex)', async () => {
      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({ authType: 'KEY', sshPassword: undefined, sshPrivateKey: REAL_PEM }),
      );
      expect(created.authType).toBe('KEY');
      const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
      expect(credentials.decrypt(row.secretCipher)).toBe(REAL_PEM);
    });

    test('create с фиктивным PEM вида AAAA — 400 до записи в БД (ревью №8)', async () => {
      await expect(
        servers.create(
          ownerId,
          workspaceId,
          dtoFor({
            authType: 'KEY',
            sshPassword: undefined,
            sshPrivateKey:
              '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n',
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(await prisma.server.count()).toBe(0);
    });

    test('list/get: свои воркспейсы, чужой сервер и чужой воркспейс — 404 неотличимо', async () => {
      const mine = await servers.create(ownerId, workspaceId, dtoFor());
      const other = await workspaces.create((await extraUser('srvout1')), { name: 'other-ws' });

      expect(await servers.findAll(ownerId, workspaceId)).toHaveLength(1);
      await expect(servers.findAll(ownerId, other.id)).rejects.toThrow(NotFoundException);
      expect(await servers.findOne(ownerId, workspaceId, mine.id)).toMatchObject({ id: mine.id });

      const outsider = await extraUser('srvout2');
      await expect(servers.findOne(outsider, workspaceId, mine.id)).rejects.toThrow(NotFoundException);

      const foreignOwner = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: other.id } });
      const foreign = await servers.create(foreignOwner.userId, other.id, dtoFor({ name: 'foreign' }));
      await expect(servers.findOne(ownerId, workspaceId, foreign.id)).rejects.toThrow(NotFoundException);
    });

    test('дубль имени — 409, дубль отпечатка хоста в воркспейсе — 409 с другим текстом', async () => {
      await servers.create(ownerId, workspaceId, dtoFor());
      await expect(servers.create(ownerId, workspaceId, dtoFor())).rejects.toThrow(ConflictException);

      const fp = `SHA256:${'A'.repeat(43)}`;
      await prisma.server.update({
        where: { workspaceId_name: { workspaceId, name: 'prod-1' } },
        data: { hostKeyFingerprint: fp },
      });
      await expect(
        servers.create(ownerId, workspaceId, dtoFor({ name: 'prod-2', host: '203.0.113.11' })),
      ).rejects.toThrow(ConflictException);
      // в другом воркспейсе тот же отпечаток допустим
      const ws2 = await workspaces.create(ownerId, { name: 'second' });
      await expect(
        servers.create(ownerId, ws2.id, dtoFor({ name: 'prod-1' })),
      ).resolves.toMatchObject({ workspaceId: ws2.id });
    });

    test('MEMBER видит список, но не создаёт сервер', async () => {
      const memberId = await inviteAndAccept('srvmember@example.com');
      await servers.create(ownerId, workspaceId, dtoFor());
      await expect(
        servers.create(memberId, workspaceId, dtoFor({ name: 'nope' })),
      ).rejects.toThrow(ForbiddenException);
      expect(await servers.findAll(memberId, workspaceId)).toHaveLength(1);
    });

    test('loadForSsh: битый cipher → 500, неизвестный kid → 500, секрета в команде нет', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      await prisma.server.update({ where: { id: created.id }, data: { secretCipher: 'garbage' } });
      await expect(servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe')).rejects.toThrow(
        'server credential unreadable',
      );

      await prisma.server.update({
        where: { id: created.id },
        data: { secretCipher: 'v1.kz.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAA' },
      });
      await expect(servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe')).rejects.toThrow(
        'server credential unreadable',
      );
      ssh.assertNoSecretLeak('sup3rsecret');
    });

    test('перевёртка ключа: cipher старого kid после успешного чтения получает активный kid', async () => {
      // Шифруем «прошлым» ключом: конфиг с active kid k0 — это состояние до ротации.
      const before = new CredentialCryptoService({
        ssh: testAppConfig().ssh,
        crypto: {
          activeKey: { id: 'k0', key: Buffer.alloc(32, 6) },
          oldKeys: new Map(),
          ephemeralServerKey: false,
        },
      } as AppConfig);
      const cipherWithOldKid = before.encrypt('sup3rsecret');
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      await prisma.server.update({
        where: { id: created.id },
        data: { secretCipher: cipherWithOldKid },
      });
      expect(cipherWithOldKid.startsWith('v1.k0.')).toBe(true);

      const { session } = await servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe');
      expect(session.secret).toBe('sup3rsecret');
      const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.secretCipher.startsWith('v1.k1.')).toBe(true); // перемололи на активный ключ
      // и после перевёртки читается то же самое
      expect(credentials.decrypt(row.secretCipher)).toBe('sup3rsecret');
    });

    test('hostKeyFingerprint в сессии: probe → null, authenticated без пина → 424', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      const probe = await servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe');
      expect(probe.session.expectedHostKeyFingerprint).toBeNull();
      expect(probe.session.address).toBe('203.0.113.10');

      await expect(
        servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'authenticated'),
      ).rejects.toMatchObject({
        status: 424,
        response: { errorCode: 'HOST_KEY_NOT_TRUSTED' },
      });

      await prisma.server.update({
        where: { id: created.id },
        data: { hostKeyFingerprint: `SHA256:${'B'.repeat(43)}` },
      });
      const pinned = await servers.loadForSsh(
        ownerId,
        workspaceId,
        created.id,
        MEMBER_ROLES,
        'authenticated',
      );
      expect(pinned.session.expectedHostKeyFingerprint).toBe(`SHA256:${'B'.repeat(43)}`);
    });

    test('запрещённый порт: 400 на create и всё равно блокируется на подключении', async () => {
      await expect(
        servers.create(ownerId, workspaceId, dtoFor({ port: 23 })),
      ).rejects.toThrow(BadRequestException);
      expect(await prisma.server.count()).toBe(0);

      // Порт был разрешён, потом админ сушил allowlist: соединение не проходит.
      const created = await servers.create(ownerId, workspaceId, dtoFor({ port: 22 }));
      const strict = new ServersService(
        prisma,
        workspaces,
        credentials,
        ssh,
        testAppConfig({ allowedPorts: [2202] }),
      );
      await expect(
        strict.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe'),
      ).rejects.toMatchObject({ response: { errorCode: 'PORT_NOT_ALLOWED' } });
      expect(ssh.commands).toHaveLength(0);
    });

    test('запрещённый адрес (метаданные облака) блокируется до обращения к каналу', async () => {
      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({ host: '169.254.169.254' }),
      );
      await expect(
        servers.loadForSsh(ownerId, workspaceId, created.id, MEMBER_ROLES, 'probe'),
      ).rejects.toMatchObject({ response: { errorCode: 'TARGET_BLOCKED' } });
      expect(ssh.commands).toHaveLength(0);
    });
  });
});
```

Правки по прогону Task 8 (все пять — следы неверных предположений черновика, а не стилистика):

1. `REAL_PEM` в тесте генерировался в `pkcs8`, который `ssh2.utils.parseKey` не читает (`Unsupported key format`) — «валидный ключ» падал на структурной проверке. Формат — `pkcs1` (или OpenSSH). Заодно добавлен тест на реально зашифрованный OpenSSH-ключ (одноразовый фикстура-PEM, `ssh-keygen -t ed25519 -N test-passphrase`), иначе ветка `encrypted private keys are not supported` остал бы непроверенной.
2. `@@unique([workspaceId, hostKeyFingerprint])` в PostgreSQL не считает `NULL` равными, поэтому «дубль отпечатка на create» из черновика невозможен: неопиленные серверы не конфликтуют по определению. Тест переписан на фактическое поведение (второй непиннутый сервер создаётся), а конфликт по отпечатку будет реально проверяться в Task 9 на `pinHostKey` — там же используется и маппинг `P2002 → 409` по этому индексу.
3. `FailedDependencyException` в Nest 11 нет (см. Global Constraints) — свой класс в `src/common/http/`, плюс проброс `errorCode` в `AllExceptionsFilter` и тест envelope.
4. В `loadForSsh` catch ловит только `SshFailure`; всё остальное перебрасывается как есть. Иначе ошибка PostgreSQL или программный сбой превращались бы в «424 target address is not allowed» — тот же приём, что и в замечании ревью №7 про `testConnection`, только на другом конце.
5. Сообщение 424 берётся из `SshFailure.message`, а не хардкодом `target address is not allowed`: для `PORT_NOT_ALLOWED` хардкод врал бы клиенту.

- [x] **Step 3: Убедиться, что падает**

Run: `npx jest src/modules/servers/servers.spec.ts` — Expected: FAIL (`./servers.service` не существует).

- [x] **Step 4: Реализовать `servers.service.ts`**

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { utils } from 'ssh2';
import {
  Prisma,
  Server,
  ServerAuthType,
  ServerStatus,
  WorkspaceRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { resolveTarget } from './ssh/network-policy';
import {
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshRunner,
  type SshSession,
} from './ssh/ssh-runner';
import type { CreateServerDto } from './dto/create-server.dto';

export const MEMBER_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.MEMBER];
export const OWNER_ONLY_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER];

export interface ServerResponse {
  id: string;
  workspaceId: string;
  name: string;
  host: string;
  port: number;
  sshUsername: string;
  authType: ServerAuthType;
  status: ServerStatus;
  hostKeyFingerprint: string | null;
  dockerVersion: string | null;
  agentVersion: string | null;
  agentInstalledAt: Date | null;
  lastAgentStatus: string | null;
  lastAgentErrorCode: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Явный список полей — секрету тут взяться неоткуда. */
export function toServerResponse(server: Server): ServerResponse {
  return {
    id: server.id,
    workspaceId: server.workspaceId,
    name: server.name,
    host: server.host,
    port: server.port,
    sshUsername: server.sshUsername,
    authType: server.authType,
    status: server.status,
    hostKeyFingerprint: server.hostKeyFingerprint,
    dockerVersion: server.dockerVersion,
    agentVersion: server.agentVersion,
    agentInstalledAt: server.agentInstalledAt,
    lastAgentStatus: server.lastAgentStatus,
    lastAgentErrorCode: server.lastAgentErrorCode,
    lastCheckedAt: server.lastCheckedAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly credentials: CredentialCryptoService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateServerDto,
  ): Promise<ServerResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, OWNER_ONLY_ROLES);

    if (!this.cfg.ssh.allowedPorts.includes(dto.port)) {
      throw new BadRequestException('port is not allowed for ssh connections');
    }
    const secret = dto.authType === ServerAuthType.PASSWORD
      ? (dto.sshPassword as string)
      : (dto.sshPrivateKey as string);
    if (dto.authType === ServerAuthType.KEY) this.assertParseablePrivateKey(secret);

    try {
      const server = await this.prisma.server.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          host: dto.host,
          port: dto.port,
          sshUsername: dto.sshUsername,
          authType: dto.authType,
          secretCipher: this.credentials.encrypt(secret),
        },
      });
      return toServerResponse(server);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = (err.meta?.['target'] ?? []) as string[];
        if (target.includes('hostKeyFingerprint')) {
          throw new ConflictException('host key already registered for another server');
        }
        throw new ConflictException('server name already used in this workspace');
      }
      throw err;
    }
  }

  /**
   * Структурная проверка ключа парсером ssh2: node:crypto НЕ читает OpenSSH-формат,
   * а именно его выдаёт современный ssh-keygen (проверено: parseKey разбирает
   * OpenSSH, возвращает Error на мусор и поднимает passphrase на зашифрованном).
   */
  private assertParseablePrivateKey(pem: string): void {
    const parsed = utils.parseKey(pem);
    if (parsed instanceof Error) {
      if (parsed.message.includes('Encrypted private OpenSSH key')) {
        throw new BadRequestException('encrypted private keys are not supported');
      }
      throw new BadRequestException('sshPrivateKey is not a valid private key');
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0 || parsed[0] instanceof Error) {
        throw new BadRequestException('sshPrivateKey is not a valid private key');
      }
    } else if ((parsed as { passphrase?: string }).passphrase !== undefined) {
      throw new BadRequestException('encrypted private keys are not supported');
    }
  }

  async findAll(userId: string, workspaceId: string): Promise<ServerResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const servers = await this.prisma.server.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return servers.map(toServerResponse);
  }

  async findOne(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<ServerResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    return toServerResponse(await this.requireRow(serverId, workspaceId));
  }

  /**
   * Скоупинг + политика + строка + сессия.
   * purpose='probe' — проверяем host key, креденшелы не отправляем;
   * 'authenticated' — требует уже принятый отпечаток.
   */
  async loadForSsh(
    userId: string,
    workspaceId: string,
    serverId: string,
    roles: WorkspaceRole[],
    purpose: 'probe' | 'authenticated',
  ): Promise<{ server: Server; session: SshSession }> {
    await this.workspaces.requireMembership(userId, workspaceId, roles);
    const server = await this.requireRow(serverId, workspaceId);

    if (purpose === 'authenticated' && !server.hostKeyFingerprint) {
      throw new FailedDependencyException({
        statusCode: 424,
        errorCode: 'HOST_KEY_NOT_TRUSTED',
        message: 'host key is not trusted yet',
      });
    }

    let address: string;
    try {
      ({ address } = await resolveTarget(server.host, server.port, {
        allowedPorts: this.cfg.ssh.allowedPorts,
        allowLoopback: this.cfg.ssh.allowLoopback,
      }));
    } catch (err) {
      const code: SshErrorCode =
        err instanceof SshFailure
          ? err.code
          : 'TARGET_BLOCKED';
      throw new FailedDependencyException({
        statusCode: 424,
        errorCode: code,
        message: 'target address is not allowed',
      });
    }

    let secret: string;
    try {
      secret = this.credentials.decrypt(server.secretCipher);
    } catch {
      throw new InternalServerErrorException('server credential unreadable');
    }

    //Write-on-read: cipher под старым kid переворачивается на активный ключ.
    if (this.credentials.needsRewrap(server.secretCipher)) {
      await this.prisma.server.update({
        where: { id: server.id },
        data: { secretCipher: this.credentials.encrypt(secret) },
      });
    }

    return {
      server,
      session: {
        host: server.host,
        address,
        port: server.port,
        username: server.sshUsername,
        authType: server.authType,
        secret,
        expectedHostKeyFingerprint:
          purpose === 'probe' ? null : server.hostKeyFingerprint,
      },
    };
  }

  /** И «нет строки», и «строка чужого воркспейса» — 404 без различия. */
  private async requireRow(serverId: string, workspaceId: string): Promise<Server> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, workspaceId },
    });
    if (!server) throw new NotFoundException();
    return server;
  }
}
```

Позиция `//Write-on-read` выше — это единственное место, где чтение порождает запись; оно оправдано тем, что иначе ротация ключа требует офлайн-джоба, которой в MVP нет. Если ревью потребует строго «GET ничего не пишет» — переноси перевёртку в `testConnection` (он и так пишет) и удаляй из `loadForSsh`.

- [x] **Step 5: Контроллер (роуты 1–3) и модуль**

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { ServerIdsDto } from './dto/server-ids.dto';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';

@Controller('workspaces/:workspaceId/servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post()
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateServerDto,
  ) {
    return this.serversService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  findAll(@User() user: JwtUserPayload, @Param() params: WorkspaceIdDto) {
    return this.serversService.findAll(user.userId, params.workspaceId);
  }

  @Get(':serverId')
  findOne(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
    return this.serversService.findOne(user.userId, params.workspaceId, params.serverId);
  }
}
```

`servers.module.ts` (параметры роутов — всегда DTO-объекты: строковая форма `@Param('id')` обходит `ValidationPipe`):

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DockerModule } from './docker/docker.module';
import { ComposeModule } from './compose/compose.module';
import { GitModule } from './git/git.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { NodeSshRunner } from './ssh/node-ssh.runner';
import { SSH_RUNNER } from './ssh/ssh-runner';

@Module({
  imports: [PrismaModule, WorkspacesModule, DockerModule, ComposeModule, GitModule],
  controllers: [ServersController],
  providers: [
    ServersService,
    CredentialCryptoService,
    { provide: SSH_RUNNER, useClass: NodeSshRunner },
  ],
})
export class ServersModule {}
```

- [x] **Step 6: Зелёные тесты, сборка, линт**

Run: `npx jest src/modules/servers/ src/modules/workspaces/ && npm run build && npx prettier --check "src/modules/servers/**/*.ts" && npx eslint src/modules/servers src/modules/workspaces` — Expected: всё чисто.

- [x] **Step 7: Коммит**

```bash
git add app/backend/src/modules/servers/ app/backend/src/modules/workspaces/
git commit -m "feat(backend): server crud with target policy and host key pin"
```

---

### Task 9: `POST .../test` — probe host key, подтверждение, проверка Docker

**Files:**
- Modify: `src/modules/servers/servers.service.ts` (`testConnection`, `pinHostKey`, `recordProbe`)
- Modify: `src/modules/servers/servers.controller.ts` (роут 4)
- Test: `src/modules/servers/servers.spec.ts` — вложенный `describe('test', ...)`

**Interfaces:**
- Consumes: `loadForSsh(..., purpose)` (Task 8), `buildDockerVersionCommand` (Task 7), `SshFailure.observedHostKeyFingerprint` (Task 5/6), `classifyDockerStderr` (этот task).
- Produces: `ServerTestResponse`, `ServersService.testConnection(userId, workspaceId, serverId, dto)`, чистая `classifyDockerFailure(code, stderr): SshErrorCode`.

Поведение, которое надо зафиксировать ревью:

| Состояние | Ответ |
|---|---|
| пина нет, `trustHostKey` нет | `200 { reachable:false, trustRequired:true, hostKeyFingerprint:<observed>, errorCode:'HOST_KEY_NOT_TRUSTED' }`, БД: `status` не меняется, `lastCheckedAt` обновлён, пин НЕ записан |
| пина нет, `trustHostKey` совпал | пин пишется → аутентифицированное подключение → `200 { reachable:true, status:'ONLINE', dockerVersion }` |
| пина нет, `trustHostKey` не совпал | `409` (`message: 'host key fingerprint does not match'`), пин не пишется, креденшелы не отправлялись |
| пин есть, ключ хоста сменился | `200 { reachable:false, status:'OFFLINE', errorCode:'HOST_KEY_MISMATCH' }` |
| auth/сеть/таймаут | `200 { reachable:false, status:'OFFLINE', errorCode }`, без 5xx |
| SSH ок, docker нет/права/сокет молчит | `200 { reachable:true, status:'ONLINE', dockerVersion:null, dockerErrorCode }` |
| упала запись в PostgreSQL | `500` (не `reachable:false`) |

- [x] **Step 1: Написать падающие тесты**

```ts
describe('test', () => {
  const observed = `SHA256:${'C'.repeat(43)}`;

  function notTrusted(match: RegExp) {
    ssh.hostKey(match, observed, 'HOST_KEY_NOT_TRUSTED');
  }

  test('probe: креденшелы не отправлены, отпечаток предложен, пин не записан', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    notTrusted(/.*/);
    const result = await servers.testConnection(ownerId, workspaceId, created.id, {});

    expect(result).toMatchObject({
      serverId: created.id,
      reachable: false,
      trustRequired: true,
      hostKeyFingerprint: observed,
      errorCode: 'HOST_KEY_NOT_TRUSTED',
      status: 'PENDING',
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hostKeyFingerprint).toBeNull();
    expect(row.lastCheckedAt).toBeInstanceOf(Date);
    expect(row.status).toBe('PENDING');
  });

  test('probe упёрся в сеть: 200 OFFLINE + сетевой код, пин не выдуман', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    ssh.fail(/.*/, new SshFailure('REFUSED', 'ssh transport failure'));
    const result = await servers.testConnection(ownerId, workspaceId, created.id, {});
    expect(result).toMatchObject({
      reachable: false,
      trustRequired: false,
      status: 'OFFLINE',
      errorCode: 'REFUSED',
      hostKeyFingerprint: null,
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hostKeyFingerprint).toBeNull();
  });

  test('подтверждение с совпадающим отпечатком: пин пишется, дальше ONLINE', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    notTrusted(/.*/);
    ssh.respond(/docker version/, '27.3.1\n');

    const result = await servers.testConnection(
      ownerId,
      workspaceId,
      created.id,
      { trustHostKey: observed },
    );
    expect(result).toMatchObject({ reachable: true, status: 'ONLINE', dockerVersion: '27.3.1', trustRequired: false });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hostKeyFingerprint).toBe(observed);
    // probe-сессияшла без секрета в команде, authenticated-сессия понесла пин
    expect(ssh.sessions[0].expectedHostKeyFingerprint).toBeNull();
    expect(ssh.sessions[1].expectedHostKeyFingerprint).toBe(observed);
  });

  test('подтверждение с НЕСОВПАДАЮЩИМ отпечатком → 409, пин не записан', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    notTrusted(/.*/);
    await expect(
      servers.testConnection(ownerId, workspaceId, created.id, {
        trustHostKey: `SHA256:${'D'.repeat(43)}`,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hostKeyFingerprint).toBeNull();
  });

  test('пин есть, хост отдал другой ключ → OFFLINE + HOST_KEY_MISMATCH', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    ssh.fail(/.*/, new SshFailure('HOST_KEY_MISMATCH', 'host key does not match', `SHA256:${'E'.repeat(43)}`));

    const result = await servers.testConnection(ownerId, workspaceId, created.id, {});
    expect(result).toMatchObject({ reachable: false, status: 'OFFLINE', errorCode: 'HOST_KEY_MISMATCH' });
  });

  test('аутентификационный сбой → 200 reachable:false + AUTH_FAILED, OFFLINE в БД', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    ssh.fail(/docker version/, new SshFailure('AUTH_FAILED', 'ssh transport failure'));
    const result = await servers.testConnection(ownerId, workspaceId, created.id, {});
    expect(result).toMatchObject({ reachable: false, status: 'OFFLINE', errorCode: 'AUTH_FAILED' });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('OFFLINE');
  });

  test('raw транспортная ошибка классифицируется без SshFailure', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    const e = new Error('connect ECONNREFUSED') as Error & { code?: string };
    e.code = 'ECONNREFUSED';
    ssh.fail(/docker version/, e);
    expect((await servers.testConnection(ownerId, workspaceId, created.id, {})).errorCode).toBe('REFUSED');
  });

  test('docker отсутствует / отказ доступа / молчащий сокет — хост остаётся ONLINE с dockerErrorCode', async () => {
    const cases: [number, string, SshErrorCode][] = [
      [127, 'bash: docker: command not found', 'DOCKER_MISSING'],
      [1, 'permission denied while trying to connect to the Docker daemon socket', 'DOCKER_PERMISSION_DENIED'],
      [1, 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock', 'DOCKER_SOCKET_UNREACHABLE'],
      [1, 'boom', 'COMMAND_FAILED'],
    ];
    for (const [code, stderr, expected] of cases) {
      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({ name: `s-${expected}` }),
      );
      await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
      ssh.respond(/docker version/, '', { code, stderr });
      const result = await servers.testConnection(ownerId, workspaceId, created.id, {});
      expect(result).toMatchObject({
        reachable: true,
        status: 'ONLINE',
        dockerVersion: null,
        dockerErrorCode: expected,
      });
    }
  });

  test('нестандартный вывод версии не идёт в БД: dockerVersion null', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    ssh.respond(/docker version/, 'Docker version 27.3.1, build ce12230\n');
    const result = await servers.testConnection(ownerId, workspaceId, created.id, {});
    expect(result).toMatchObject({ reachable: true, dockerVersion: null });
  });

  test('падение записи в PostgreSQL → 500, а не ложный reachable:false (ревью №7)', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    ssh.respond(/docker version/, '27.3.1');
    const original = prisma.server.update.bind(prisma.server);
    prisma.server.update = (async () => {
      throw new Error('connection terminated unexpectedly');
    }) as typeof prisma.server.update;
    try {
      await expect(
        servers.testConnection(ownerId, workspaceId, created.id, {}),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    } finally {
      prisma.server.update = original;
    }
  });

  test('чужой сервер → 404, канал SSH не тронут', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    const outsider = await extraUser('srvout3');
    await expect(
      servers.testConnection(outsider, workspaceId, created.id, {}),
    ).rejects.toThrow(NotFoundException);
    expect(ssh.commands).toHaveLength(0);
  });

  test('MEMBER может вызывать test', async () => {
    const memberId = await inviteAndAccept('srvmember2@example.com');
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    notTrusted(/.*/);
    await expect(
      servers.testConnection(memberId, workspaceId, created.id, {}),
    ).resolves.toMatchObject({ trustRequired: true });
  });
});
```

Добавить в импорты спека: `InternalServerErrorException` из `@nestjs/common`, `SshFailure` и тип `SshErrorCode` из `./ssh/ssh-runner`.

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/servers.spec.ts -t 'test'` — Expected: FAIL (`testConnection` нет).

- [x] **Step 3: Реализовать `testConnection`**

```ts
export interface ServerTestResponse {
  serverId: string;
  reachable: boolean;
  trustRequired: boolean;
  status: ServerStatus;
  latencyMs: number;
  dockerVersion: string | null;
  dockerErrorCode: SshErrorCode | null;
  errorCode: SshErrorCode | null;
  hostKeyFingerprint: string | null;
  checkedAt: Date;
}

/** Вывод docker-version принимаем только как NN[.NN]*(-rc)? — не произвольный текст хоста. */
const DOCKER_VERSION_RE = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.]+)?$/;

/** Почему Docker не отвечает — три разных диагноза, не один «DOCKER_MISSING» (ревью №5). */
export function classifyDockerFailure(code: number | null, stderr: string): SshErrorCode {
  const lower = stderr.toLowerCase();
  if (code === 127 || lower.includes('command not found')) return 'DOCKER_MISSING';
  if (lower.includes('permission denied')) return 'DOCKER_PERMISSION_DENIED';
  if (lower.includes('cannot connect to the docker daemon')) return 'DOCKER_SOCKET_UNREACHABLE';
  return 'COMMAND_FAILED';
}
```

```ts
async testConnection(
  userId: string,
  workspaceId: string,
  serverId: string,
  dto: TestServerDto,
): Promise<ServerTestResponse> {
  const startedAt = Date.now();
  const checkedAt = new Date();

  // 1. Пина нет — сначала probe: верификатор при expectedHostKeyFingerprint === null
  //    всегда возвращает false, поэтому аутентификации на этом шаге не происходит.
  const probe = await this.loadForSsh(userId, workspaceId, serverId, MEMBER_ROLES, 'probe');
  if (!probe.server.hostKeyFingerprint) {
    let failure: SshFailure | null = null;
    try {
      await this.ssh.exec(probe.session, 'true', this.cfg.ssh.connectTimeoutMs);
    } catch (err) {
      if (!(err instanceof SshFailure)) throw err;
      failure = err;
    }

    const observed = failure?.observedHostKeyFingerprint ?? null;
    if (observed === null) {
      // Рукопожатие не дошло до ключа хоста: это сетевой отказ, а не «ключ не подтверждён».
      const latencyMs = Date.now() - startedAt;
      await this.recordProbe(serverId, ServerStatus.OFFLINE, null, checkedAt);
      return this.unreachableResult(
        serverId,
        failure ?? new Error('host key probe produced no fingerprint'),
        latencyMs,
        checkedAt,
      );
    }

    if (!dto.trustHostKey) {
      await this.prisma.server.update({
        where: { id: serverId },
        data: { lastCheckedAt: checkedAt },
      });
      return {
        serverId,
        reachable: false,
        trustRequired: true,
        status: probe.server.status,
        latencyMs: Date.now() - startedAt,
        dockerVersion: null,
        dockerErrorCode: null,
        errorCode: 'HOST_KEY_NOT_TRUSTED',
        hostKeyFingerprint: observed,
        checkedAt,
      };
    }
    if (dto.trustHostKey !== observed) {
      throw new ConflictException('host key fingerprint does not match');
    }
    await this.prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: observed, lastCheckedAt: checkedAt },
    });
  }

  // 2. Аутентифицированная проверка.
  const { server, session } = await this.loadForSsh(
    userId,
    workspaceId,
    serverId,
    MEMBER_ROLES,
    'authenticated',
  );
  let exec: SshExecResult;
  try {
    exec = await this.ssh.exec(
      session,
      buildDockerVersionCommand(),
      this.cfg.ssh.commandTimeoutMs,
    );
  } catch (err) {
    await this.recordProbe(serverId, ServerStatus.OFFLINE, null, checkedAt);
    return this.unreachableResult(serverId, err, Date.now() - startedAt, checkedAt);
  }

  const latencyMs = Date.now() - startedAt;
  if (exec.code !== 0) {
    const dockerErrorCode = classifyDockerFailure(exec.code, exec.stderr);
    await this.recordProbe(serverId, ServerStatus.ONLINE, null, checkedAt);
    return {
      serverId,
      reachable: true,
      trustRequired: false,
      status: ServerStatus.ONLINE,
      latencyMs,
      dockerVersion: null,
      dockerErrorCode,
      errorCode: null,
      hostKeyFingerprint: server.hostKeyFingerprint,
      checkedAt,
    };
  }

  const candidate = exec.stdout.trim();
  const dockerVersion = DOCKER_VERSION_RE.test(candidate) ? candidate.slice(0, 32) : null;
  await this.recordProbe(serverId, ServerStatus.ONLINE, dockerVersion, checkedAt);
  return {
    serverId,
    reachable: true,
    trustRequired: false,
    status: ServerStatus.ONLINE,
    latencyMs,
    dockerVersion,
    dockerErrorCode: null,
    errorCode: null,
    hostKeyFingerprint: server.hostKeyFingerprint,
    checkedAt,
  };
}

private unreachableResult(
  serverId: string,
  err: unknown,
  latencyMs: number,
  checkedAt: Date,
): ServerTestResponse {
  const failure = err instanceof SshFailure ? err : null;
  const errorCode = failure ? failure.code : classifySshError(err);
  return {
    serverId,
    reachable: false,
    trustRequired: false,
    status: ServerStatus.OFFLINE,
    latencyMs,
    dockerVersion: null,
    dockerErrorCode: null,
    errorCode,
    hostKeyFingerprint: failure?.observedHostKeyFingerprint ?? null,
    checkedAt,
  };
}

private async recordProbe(
  serverId: string,
  status: ServerStatus,
  dockerVersion: string | null,
  checkedAt: Date,
): Promise<void> {
  await this.prisma.server.update({
    where: { id: serverId },
    data: { status, dockerVersion, lastCheckedAt: checkedAt },
  });
}
```

Три вещи, за которыми смотреть на ревью: (1) `recordProbe` вызывается **вне** `try`, поэтому сбой БД не превращается в `reachable:false` (тест с подменой `prisma.server.update`); (2) в probe-ветке команда — `true`, а `expectedHostKeyFingerprint === null`, то есть пароль/ключ на неподтверждённый хост физически не уходят; (3) `latencyMs` на probe-ответе измеряет именно probe (рукопожатие), а не «задержку подключения к Docker» — это разные числа, и в ONLINE-ветке оно считается после аутентифицированного `exec`.

Дополнено по прогону Task 9:

- Тест с подменой `prisma.server.update` требует не «пусть летит наружу», а явный `InternalServerErrorException` (иначе `rejects.toBeInstanceOf(...)` не сходится, а 500 из raw-ошибки — слишком неопределённая форма). Все записи результата probe идут через `saveProbe()`, который ловит сбой БД и переписывает его в 500 с `cause`; `recordProbe` и запись пина вызывают только её.
- `@@unique([workspaceId, hostKeyFingerprint])` реально мешает: тест, который пинит несколько серверов одного воркспейса одним и тем же отпечатком, падает на P2002. Это и есть ожидаемое поведение индекса («один ключ хоста — один сервер в воркспейсе»), поэтому в таком тесте пин на каждый сервер свой. Тот же индекс даст `P2002` в `pinHostKey` (Task 9 подтверждение пина) — маппинг в 409 уже лежит в `mapConflict`.
- В probe-ветке `unreachableResult` получает `SshFailure('NETWORK', …)` как fallback, а не `new Error('host key probe produced no fingerprint')`: у строки-ошибки нет кода, и классификатор вынужден был бы угадывать.

- [x] **Step 4: Роут**

```ts
@Post(':serverId/test')
@HttpCode(200)
@ThrottleProfile('sshOps')
test(
  @User() user: JwtUserPayload,
  @Param() params: ServerIdsDto,
  @Body() dto: TestServerDto,
) {
  return this.serversService.testConnection(
    user.userId,
    params.workspaceId,
    params.serverId,
    dto,
  );
}
```

`@HttpCode(200)` обязателен: Nest дал бы 201 на `@Post`. Пустое тело `{}` валидно (`@IsOptional()` на `trustHostKey`), а `forbidNonWhitelisted` отсекает опечатки в имени поля.

- [x] **Step 5: Зелёные тесты, сборка, линт**

Run: `npx jest src/modules/servers/ && npm run build && npx eslint src/modules/servers` — Expected: PASS. Тест «probe» требует, чтобы `ssh.hostKey(/.*/, …)` матчился на команду `true` — регулярка `/.*/` это покрывает; если решишь сузить до `/^true$/`, зарекай отдельно для `true` и `docker version`.

- [x] **Step 6: Коммит**

```bash
git add app/backend/src/modules/servers/
git commit -m "feat(backend): probe ssh host key before authenticating on test"
```

---

### Task 10: `agent/install` и `GET agent`: успех только по подтверждённому `ACTIVE`

**Files:**
- Create: `src/modules/servers/agent.service.ts`
- Modify: `src/modules/servers/servers.controller.ts` (роуты 5–6), `servers.module.ts` (провайдер)
- Test: `src/modules/servers/servers.spec.ts` — вложенный `describe('agent', ...)`

**Interfaces:**
- Consumes: `loadForSsh(..., 'authenticated')` (Task 8 — без принятого пина бросает 424), `agentStatusOf`/`parseAgentState`/`buildAgentReadCommand`/`buildInstallScript` (Task 7), `AgentReportStatus` (Task 1).
- Produces: `AgentService.status/install`, `AgentResponse`, `AgentInstallResponse`, `hostErrorCode(code, stderr)`, `AGENT_READ_COMMAND` (постоянный regex-маркер `/systemctl is-active/`).

- [x] **Step 1: Написать падающие тесты**

Хелпер `active(...)` печатает полный протокол; порядок зарекаенных ответов = порядок удалённых вызовов (каждый расходется один раз).

```ts
describe('agent', () => {
  let agent: AgentService;
  const observed = `SHA256:${'C'.repeat(43)}`;

  beforeEach(() => {
    agent = new AgentService(servers, prisma, ssh, testAppConfig());
  });

  const notInstalled = 'SD=ok\nMF=absent\nJSON=-\nUNIT=no-unit\nHB=-\nNOW=1700000000\n';
  const active = (
    serverId: string,
    opts: { version?: string; hb?: string; now?: string; unit?: string; sd?: string } = {},
  ): string =>
    [
      `SD=${opts.sd ?? 'ok'}`,
      'MF=present',
      `JSON={"version":"${opts.version ?? '0.1.0'}","workspaceId":"${workspaceId}","serverId":"${serverId}"}`,
      `UNIT=${opts.unit ?? 'active'}`,
      `HB=${opts.hb ?? '1699999990'}`,
      `NOW=${opts.now ?? '1699999995'}`,
    ].join('\n');

  /** Сервер с уже принятым host key — иначе и install, и status получают 424. */
  async function trustedServer(name = 'prod-1'): Promise<string> {
    const created = await servers.create(ownerId, workspaceId, dtoFor({ name }));
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    return created.id;
  }

  test('install: read→script→read, ACTIVE и совпадение версии → INSTALLED', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(serverId));

    const result = await agent.install(ownerId, workspaceId, serverId);
    expect(result.outcome).toBe('INSTALLED');
    expect(result.agent).toMatchObject({ status: 'ACTIVE', version: '0.1.0', errorCode: null });

    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.agentVersion).toBe('0.1.0');
    expect(row.agentInstalledAt).toBeInstanceOf(Date);
    expect(row.lastAgentStatus).toBe('ACTIVE');
    expect(row.status).toBe('ONLINE');

    expect(ssh.commands).toHaveLength(3);
    expect(ssh.commands[1]).toContain('systemctl enable bios-agent.service');
    expect(ssh.commands[1]).toContain(`"serverId":"${serverId}"`);
    expect(ssh.commands[1]).toContain('sudo -n'); // sshUsername = deploy
    expect(ssh.commands.join('\n')).not.toContain('sup3rsecret');
  });

  test('install под root: без sudo-обёрток', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor({ sshUsername: 'root' }));
    await prisma.server.update({ where: { id: created.id }, data: { hostKeyFingerprint: observed } });
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(created.id));
    await agent.install(ownerId, workspaceId, created.id);
    expect(ssh.commands[1]).not.toContain('sudo -n');
  });

  test('повторный install: ALREADY_ACTIVE, скрипт не запускается', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(serverId));
    await agent.install(ownerId, workspaceId, serverId);
    expect(ssh.commands).toHaveLength(3);

    ssh.respond(/systemctl is-active/, active(serverId));
    const second = await agent.install(ownerId, workspaceId, serverId);
    expect(second.outcome).toBe('ALREADY_ACTIVE');
    expect(ssh.commands).toHaveLength(4);
  });

  test('install: юнит поднялся, но версия другая → 424 AGENT_VERSION_MISMATCH, installedAt не выставлен', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(serverId, { version: '0.0.9' }));
    await expect(agent.install(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'AGENT_VERSION_MISMATCH' },
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.agentInstalledAt).toBeNull();
    expect(row.lastAgentStatus).toBe('ACTIVE'); // диагностику сохранили, успех не заявили
  });

  test('install: после скрипта юнит не активен → 424 AGENT_NOT_RUNNING', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(serverId, { unit: 'failed' }));
    await expect(agent.install(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'AGENT_NOT_RUNNING' },
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.lastAgentStatus).toBe('FAILED');
    expect(row.agentInstalledAt).toBeNull();
  });

  test('install: heartbeat не поспел → 424 AGENT_HEARTBEAT_STALE', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active(serverId, { hb: '1699900000', now: '1699999995' }));
    await expect(agent.install(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'AGENT_HEARTBEAT_STALE' },
    });
  });

  test('install: нулевой код, но манифеста на хосте нет → 424 AGENT_MANIFEST_MISSING', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(
      /systemctl is-active/,
      'SD=ok\nMF=present\nJSON=-\nUNIT=active\nHB=-\nNOW=1700000000\n',
    );
    await expect(agent.install(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'MANIFEST_INVALID' },
    });
  });

  test('install: префлайт 45 → 424 DOCKER_PERMISSION_DENIED, хост остаётся reachable, агент — нет', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '', {
      code: 45,
      stderr: 'permission denied while trying to connect to the Docker daemon socket\n',
    });
    await expect(agent.install(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'DOCKER_PERMISSION_DENIED' },
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.status).toBe('ONLINE'); // ось SSH не упала: мы соединились и получили отказ хоста
    expect(row.lastAgentErrorCode).toBe('DOCKER_PERMISSION_DENIED');
  });

  test('status: NOT_INSTALLED не трогает axis доступности хоста', async () => {
    const serverId = await trustedServer();
    await prisma.server.update({ where: { id: serverId }, data: { status: 'ONLINE' } });
    ssh.respond(/systemctl is-active/, notInstalled);
    const result = await agent.status(ownerId, workspaceId, serverId);
    expect(result).toMatchObject({ status: 'NOT_INSTALLED', errorCode: null, version: null });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.status).toBe('ONLINE');
    expect(row.lastAgentStatus).toBe('NOT_INSTALLED');
  });

  test('status: FAILED и STALE различимы, хост при этом ONLINE', async () => {
    const serverId = await trustedServer();
    await prisma.server.update({ where: { id: serverId }, data: { status: 'ONLINE' } });
    ssh.respond(/systemctl is-active/, active(serverId, { unit: 'failed' }));
    expect(await agent.status(ownerId, workspaceId, serverId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'AGENT_NOT_RUNNING',
    });
    ssh.respond(/systemctl is-active/, active(serverId, { hb: '1699900000', now: '1699999995' }));
    expect(await agent.status(ownerId, workspaceId, serverId)).toMatchObject({
      status: 'STALE',
      errorCode: 'AGENT_HEARTBEAT_STALE',
    });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.status).toBe('ONLINE');
    expect(row.lastAgentStatus).toBe('STALE');
  });

  test('status: агент чужого сервера на том же хосте → FAILED + IDENTITY_MISMATCH', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, active('01912345-6789-7abc-aef0-1234567890ff'));
    const result = await agent.status(ownerId, workspaceId, serverId);
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'IDENTITY_MISMATCH' });
    const row = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.agentVersion).toBeNull();
  });

  test('status: systemd отсутствует → FAILED + SYSTEMD_MISSING (не NOT_INSTALLED, ревью №6)', async () => {
    const serverId = await trustedServer();
    ssh.respond(
      /systemctl is-active/,
      `SD=missing\nMF=present\nJSON={"version":"0.1.0","workspaceId":"${workspaceId}","serverId":"${serverId}"}\nUNIT=inactive\nHB=1699999990\nNOW=1699999995\n`,
    );
    expect(await agent.status(ownerId, workspaceId, serverId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'SYSTEMD_MISSING',
    });
  });

  test('status: хост выдал мусор вместо протокола → 424 READ_FAILED', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, 'bash: line 3: printf: command not found\n');
    await expect(agent.status(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'READ_FAILED' },
    });
  });

  test('status: ненулевой код удалённой команды → 424 READ_FAILED', async () => {
    const serverId = await trustedServer();
    ssh.respond(/systemctl is-active/, 'SD=ok\nMF=absent\nJSON=-\nUNIT=no-unit\nHB=-\n', { code: 2 });
    await expect(agent.status(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'READ_FAILED' },
    });
  });

  test('сбой транспорта → 424 с кодом, без 5xx', async () => {
    const serverId = await trustedServer();
    ssh.fail(/systemctl is-active/, new SshFailure('TIMEOUT', 'ssh operation timed out'));
    await expect(agent.status(ownerId, workspaceId, serverId)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'TIMEOUT' },
    });
  });

  test('без принятого host key оба роута дают 424, канал не тронут', async () => {
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    await expect(agent.status(ownerId, workspaceId, created.id)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'HOST_KEY_NOT_TRUSTED' },
    });
    await expect(agent.install(ownerId, workspaceId, created.id)).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'HOST_KEY_NOT_TRUSTED' },
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('чужой сервер → 404; MEMBER читает статус, но не ставит', async () => {
    const serverId = await trustedServer();
    const outsider = await extraUser('srvout4');
    await expect(agent.status(outsider, workspaceId, serverId)).rejects.toThrow(NotFoundException);
    await expect(agent.install(outsider, workspaceId, serverId)).rejects.toThrow(NotFoundException);

    const memberId = await inviteAndAccept('srvmember3@example.com');
    ssh.respond(/systemctl is-active/, notInstalled);
    await expect(
      agent.status(memberId, workspaceId, serverId),
    ).resolves.toMatchObject({ status: 'NOT_INSTALLED' });
    await expect(
      agent.install(memberId, workspaceId, serverId),
    ).rejects.toThrow(ForbiddenException);
    expect(ssh.commands.filter((c) => c.includes('systemctl daemon-reload'))).toHaveLength(0);
  });
});
```

Добавить в импорты спека `AgentService` из `./agent.service`.

- [x] **Step 2: Убедиться, что падает**

Run: `npx jest src/modules/servers/servers.spec.ts -t 'agent'` — Expected: FAIL.

- [x] **Step 3: Реализовать `agent.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { AgentReportStatus, Server, ServerStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import {
  classifySshError,
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh/ssh-runner';
import { MEMBER_ROLES, OWNER_ONLY_ROLES, ServersService } from './servers.service';
import {
  agentStatusOf,
  buildAgentReadCommand,
  buildInstallScript,
  parseAgentState,
  type AgentStatus,
} from './agent/agent-script';

export interface AgentResponse {
  serverId: string;
  status: AgentStatus;
  version: string | null;
  installedAt: Date | null;
  lastHeartbeatAt: Date | null;
  dockerVersion: string | null;
  errorCode: SshErrorCode | null;
  checkedAt: Date;
}

export interface AgentInstallResponse {
  serverId: string;
  outcome: 'INSTALLED' | 'ALREADY_ACTIVE';
  agent: AgentResponse;
}

/** Маркеры префлайта install-скрипта (Task 7) → коды ошибок API. */
export function hostErrorCode(code: number | null, stderr: string): SshErrorCode {
  const lower = stderr.toLowerCase();
  if (stderr.includes('BIOS_ERR_DOCKER_PERM') || code === 45) return 'DOCKER_PERMISSION_DENIED';
  if (stderr.includes('BIOS_ERR_DOCKER_SOCKET') || code === 46) return 'DOCKER_SOCKET_UNREACHABLE';
  if (stderr.includes('BIOS_ERR_DOCKER') || code === 42) return 'DOCKER_MISSING';
  if (stderr.includes('BIOS_ERR_SYSTEMD') || code === 43) return 'SYSTEMD_MISSING';
  if (lower.includes('sudo: a password is required') || lower.includes('sudo: interactive')) {
    return 'SUDO_REQUIRED';
  }
  return 'COMMAND_FAILED';
}

const REPORT_STATUS: Record<AgentStatus, AgentReportStatus> = {
  NOT_INSTALLED: AgentReportStatus.NOT_INSTALLED,
  FAILED: AgentReportStatus.FAILED,
  STALE: AgentReportStatus.STALE,
  ACTIVE: AgentReportStatus.ACTIVE,
};

@Injectable()
export class AgentService {
  constructor(
    private readonly servers: ServersService,
    private readonly prisma: PrismaService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async status(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<AgentResponse> {
    const { server, session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      'authenticated',
    );
    const reading = await this.readAgent(session, server);
    await this.recordAgent(server.id, reading, { keepInstalledAt: true });
    return reading;
  }

  async install(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<AgentInstallResponse> {
    const { server, session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      OWNER_ONLY_ROLES,
      'authenticated',
    );

    const before = await this.readAgent(session, server);
    const alreadyActive =
      before.status === 'ACTIVE' && before.version === this.cfg.ssh.agentVersion;

    if (!alreadyActive) {
      const res = await this.execOr424(
        session,
        buildInstallScript({
          workspaceId: server.workspaceId,
          serverId: server.id,
          version: this.cfg.ssh.agentVersion,
          root: server.sshUsername === 'root',
        }),
        this.cfg.ssh.installTimeoutMs,
      );
      if (res.code !== 0) {
        const errorCode = hostErrorCode(res.code, res.stderr);
        await this.recordAgentFailure(server.id, errorCode);
        throw new FailedDependencyException({
          statusCode: 424,
          errorCode,
          message: 'agent install failed on host',
        });
      }
    }

    const after = alreadyActive ? before : await this.readAgent(session, server);
    if (!alreadyActive) {
      // Нулевой код скрипта ничего не обещает: успех = ACTIVE + наша версия (ревью №4).
      const confirmed =
        after.status === 'ACTIVE' && after.version === this.cfg.ssh.agentVersion;
      if (!confirmed) {
        const errorCode: SshErrorCode =
          after.version !== this.cfg.ssh.agentVersion
            ? 'AGENT_VERSION_MISMATCH'
            : (after.errorCode ?? 'AGENT_NOT_RUNNING');
        await this.recordAgent(server.id, after, { keepInstalledAt: true });
        throw new FailedDependencyException({
          statusCode: 424,
          errorCode,
          message: 'agent is not confirmed active after install',
        });
      }
    }

    const installedAt = alreadyActive ? server.agentInstalledAt : new Date();
    await this.prisma.server.update({
      where: { id: server.id },
      data: {
        status: ServerStatus.ONLINE,
        agentVersion: after.version,
        agentInstalledAt: installedAt,
        lastAgentStatus: REPORT_STATUS[after.status],
        lastAgentErrorCode: after.errorCode,
        lastCheckedAt: after.checkedAt,
      },
    });

    return {
      serverId: server.id,
      outcome: alreadyActive ? 'ALREADY_ACTIVE' : 'INSTALLED',
      agent: { ...after, installedAt },
    };
  }

  /**
   * Чтение состояния. Проверка результата обязательна: ненулевой код или
   * нераспознанный протокол — это 424 READ_FAILED, а не «агент не установлен».
   */
  private async readAgent(session: SshSession, server: Server): Promise<AgentResponse> {
    const res = await this.execOr424(
      session,
      buildAgentReadCommand(),
      this.cfg.ssh.commandTimeoutMs,
    );
    const state = parseAgentState(res.stdout);
    const { status, errorCode } = agentStatusOf(state, this.cfg.ssh.heartbeatStaleSec, {
      workspaceId: server.workspaceId,
      serverId: server.id,
    });
    if (res.code !== 0 || errorCode === 'READ_FAILED') {
      throw new FailedDependencyException({
        statusCode: 424,
        errorCode: 'READ_FAILED',
        message: 'host did not return a readable agent state',
      });
    }
    return {
      serverId: server.id,
      status,
      version: state.manifest?.version ?? null,
      installedAt: server.agentInstalledAt,
      lastHeartbeatAt:
        state.heartbeatSec === null ? null : new Date(state.heartbeatSec * 1000),
      dockerVersion: server.dockerVersion,
      errorCode,
      checkedAt: new Date(),
    };
  }

  /** Ось агента пишется, ось доступности хоста — нет (ревью №4). */
  private async recordAgent(
    serverId: string,
    agent: AgentResponse,
    opts: { keepInstalledAt: boolean },
  ): Promise<void> {
    void opts;
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status: ServerStatus.ONLINE,
        agentVersion: agent.status === 'NOT_INSTALLED' ? null : agent.version,
        lastAgentStatus: REPORT_STATUS[agent.status],
        lastAgentErrorCode: agent.errorCode,
        lastCheckedAt: agent.checkedAt,
      },
    });
  }

  private async recordAgentFailure(
    serverId: string,
    errorCode: SshErrorCode,
  ): Promise<void> {
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        // Скрипт отработал на хосте: SSH доступен, агент — нет.
        lastAgentStatus: AgentReportStatus.FAILED,
        lastAgentErrorCode: errorCode,
        lastCheckedAt: new Date(),
      },
    });
  }

  private async execOr424(
    session: SshSession,
    command: string,
    timeoutMs: number,
  ): Promise<SshExecResult> {
    try {
      return await this.ssh.exec(session, command, timeoutMs);
    } catch (err) {
      const code = err instanceof SshFailure ? err.code : classifySshError(err);
      throw new FailedDependencyException({
        statusCode: 424,
        errorCode: code,
        message: 'server unreachable',
      });
    }
  }
}
```

Параметр `opts.keepInstalledAt` из черновика удалён как мёртвый: `recordAgent` пишет ровно то, что лежит в `AgentResponse`, а `installedAt` в этом объекте уже равен тому, что должно остаться в строке (для `status()` — значение строки, для успешного install — свежий `new Date()`). Мёртвый аргумент с `void opts` в финальном коде недопустим.

Поправки по прогону Task 10:

- `classifySshError` импортируется из `./ssh/classify-ssh-error`, а не из `./ssh/ssh-runner` (в черновике путь неверный, сборки бы не было).
- `FailedDependencyException` — свой класс (см. Global Constraints), конструктор принимает `{ errorCode, message }`, `statusCode` внутри тела он ставит сам.
- `recordAgentFailure` обязан писать `status: ONLINE`. Тест на префлайт-45 это и проверяет: мы соединились с хостом и получили от него отказ — ось доступности не падала, а черновик оставлял строку в `PENDING`, то есть врал.
- Диагноз `AGENT_VERSION_MISMATCH` ставится только когда юнит реально `ACTIVE`, но версия другая. Иначе `MANIFEST_INVALID` (пустой манифест → `version: null`) подменялся версией-несовпадением, и тест это поймал.
- Версию чужого агента под свой сервер не пишем: при `IDENTITY_MISMATCH` `agentVersion` остаётся null (иначе GET показал бы «на этом сервере стоит 0.1.0», хотя манифест относится к другому серверу).
- Тест «после install нулевой код, но манифеста нет» переименован: по машине состояний это `MANIFEST_INVALID` (файл есть, содержимое нечитабельно), а `AGENT_MANIFEST_MISSING` — это `MF=absent` при активном юните.
- `@HttpCode(201)` на install не нужен: Nest и так отдаёт 201 на `@Post`.

- [x] **Step 4: Роуты 5–6 и провайдер**

```ts
@Post(':serverId/agent/install')
@HttpCode(201)
@ThrottleProfile('sshOps')
installAgent(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
  return this.agentService.install(user.userId, params.workspaceId, params.serverId);
}

@Get(':serverId/agent')
@ThrottleProfile('sshOps')
agent(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
  return this.agentService.status(user.userId, params.workspaceId, params.serverId);
}
```

`AgentService` — в конструктор контроллера и в `providers` модуля.

- [x] **Step 5: Зелёные тесты, сборка, линт**

Run: `npx jest && npm run build && npx eslint src/modules/servers` — Expected: весь прогон зелёный (baseline Task 0 + новые suites).

- [x] **Step 6: Коммит**

```bash
git add app/backend/src/modules/servers/
git commit -m "feat(backend): install host agent with confirmed-active success only"
```

---

### Task 11: Сквозной e2e через куки, живой SSH-smoke и DoD

**Files:**
- Create: `app/backend/test/servers.e2e-spec.ts`
- Больше ничего; если smoke вскроет баг — фикс отдельным коммитом с пояснением.

**Interfaces:**
- Consumes: `AppModule`, `SSH_RUNNER` (override), `FakeSshRunner`, `ACCESS_COOKIE_NAME`, БД `bios_test_servers`, `GET /api/v1/health` (существующий `AppController`).

- [x] **Step 1: Написать e2e-спеку**

`loadAppConfig()` выполняется при импорте `app-config.module.ts`, поэтому env задаются ДО `require` (`import` хойстится и не подойдёт).

```ts
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://sabir@localhost:5432/bios_test_servers?schema=public';
process.env.NODE_ENV = 'development';
process.env.EMAIL_VERIFY_MX = 'false';
process.env.THROTTLE_SSH_OPS_LIMIT = '100';
process.env.SSH_ALLOWED_PORTS = '22,2202';
process.env.SSH_ALLOW_LOOPBACK = 'true';

const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
const { AllExceptionsFilter } = require('../src/common/filters/all-exceptions.filter') as typeof import('../src/common/filters/all-exceptions.filter');
const { SSH_RUNNER } = require('../src/modules/servers/ssh/ssh-runner') as typeof import('../src/modules/servers/ssh/ssh-runner');
const { FakeSshRunner } = require('../src/modules/servers/ssh/fake-ssh.runner') as typeof import('../src/modules/servers/ssh/fake-ssh.runner');
const { PrismaService } = require('../src/database/prisma/prisma.service') as typeof import('../src/database/prisma/prisma.service');
const { ACCESS_COOKIE_NAME } = require('../src/modules/auth/auth-cookies') as typeof import('../src/modules/auth/auth-cookies');

describe('servers e2e (cookies + fake ssh)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let ssh: InstanceType<typeof FakeSshRunner>;

  beforeAll(async () => {
    ssh = new FakeSshRunner();
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SSH_RUNNER)
      .useValue(ssh)
      .compile();

    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  async function loginAs(email: string, username: string): Promise<string[]> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, email, password: 'secret123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(201);
    const cookies = login.get('set-cookie') as unknown as string[];
    expect(cookies.join(';')).toContain(ACCESS_COOKIE_NAME);
    return cookies;
  }

  async function newWorkspace(email: string, username: string) {
    const cookies = await loginAs(email, username);
    const ws = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Cookie', cookies)
      .send({ name: `e2e-${username}` })
      .expect(201);
    return { cookies, workspaceId: ws.body.id as string };
  }

  const observed = `SHA256:${'C'.repeat(43)}`;
  const notInstalled = 'SD=ok\nMF=absent\nJSON=-\nUNIT=no-unit\nHB=-\nNOW=1700000000\n';

  test('полный путь: server → probe host key → подтверждение → test → install → agent', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-owner@example.com', 'e2eowner');
    const serversUrl = `/api/v1/workspaces/${workspaceId}/servers`;

    const created = await request(app.getHttpServer())
      .post(serversUrl)
      .set('Cookie', cookies)
      .send({ name: 'e2e-1', host: '203.0.113.20', sshUsername: 'deploy', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', hostKeyFingerprint: null, port: 22 });
    expect(created.body).not.toHaveProperty('secretCipher');
    expect(created.body).not.toHaveProperty('sshPassword');
    const url = `${serversUrl}/${created.body.id}`;

    ssh.hostKey(/.*/, observed, 'HOST_KEY_NOT_TRUSTED');
    const probe = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(200);
    expect(probe.body).toMatchObject({
      reachable: false,
      trustRequired: true,
      hostKeyFingerprint: observed,
      errorCode: 'HOST_KEY_NOT_TRUSTED',
    });

    // Подтверждение с ЧУЖИМ отпечатком не принимается и пин не пишет.
    await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({ trustHostKey: `SHA256:${'D'.repeat(43)}` })
      .expect(409);

    ssh.hostKey(/.*/, observed, 'HOST_KEY_NOT_TRUSTED');
    ssh.respond(/docker version/, '27.3.1\n');
    const confirmed = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({ trustHostKey: observed })
      .expect(200);
    expect(confirmed.body).toMatchObject({ reachable: true, status: 'ONLINE', dockerVersion: '27.3.1' });

    const active = `SD=ok\nMF=present\nJSON={"version":"0.1.0","workspaceId":"${workspaceId}","serverId":"${created.body.id}"}\nUNIT=active\nHB=1699999990\nNOW=1699999995\n`;
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active);
    const installed = await request(app.getHttpServer())
      .post(`${url}/agent/install`)
      .set('Cookie', cookies)
      .expect(201);
    expect(installed.body).toMatchObject({ outcome: 'INSTALLED', agent: { status: 'ACTIVE' } });

    ssh.respond(/systemctl is-active/, active);
    const agentStatus = await request(app.getHttpServer())
      .get(`${url}/agent`)
      .set('Cookie', cookies)
      .expect(200);
    expect(agentStatus.body).toMatchObject({ status: 'ACTIVE', version: '0.1.0', errorCode: null });
    expect(ssh.commands.join('\n')).not.toContain('sup3rsecret');

    const details = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', cookies)
      .expect(200);
    expect(details.body).toMatchObject({ hostKeyFingerprint: observed, lastAgentStatus: 'ACTIVE' });
  });

  test('install без подтверждённого host key → 424, креденшелы не отправлялись', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-nopin@example.com', 'e2enopin');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({ name: 'np', host: '203.0.113.24', sshUsername: 'root', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers/${created.body.id}/agent/install`)
      .set('Cookie', cookies)
      .expect(424);
    expect(res.body).toMatchObject({ statusCode: 424, errorCode: 'HOST_KEY_NOT_TRUSTED' });
    expect(ssh.commands).toHaveLength(0);
  });

  test('метаданные облака блокируются: test даёт 200 с TARGET_BLOCKED', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-ssrf@example.com', 'e2essrf');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({ name: 'meta', host: '169.254.169.254', sshUsername: 'root', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers/${created.body.id}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(424);
    expect(res.body).toMatchObject({ statusCode: 424, errorCode: 'TARGET_BLOCKED' });
  });

  test('порт вне allowlist → 400 на создании', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-port@example.com', 'e2eport');
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({ name: 'p', host: '203.0.113.25', port: 23, sshUsername: 'root', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(400);
  });

  test('недостижимый хост: test 200 reachable:false, install 424', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-down@example.com', 'e2edown');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({ name: 'down', host: '203.0.113.21', sshUsername: 'root', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(201);
    await prisma.server.update({
      where: { id: created.body.id },
      data: { hostKeyFingerprint: observed },
    });
    const url = `/api/v1/workspaces/${workspaceId}/servers/${created.body.id}`;

    const e = new Error('connect ECONNREFUSED 203.0.113.21:22') as Error & { code?: string };
    e.code = 'ECONNREFUSED';
    ssh.fail(/docker version/, e);
    const probe = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(200);
    expect(probe.body).toMatchObject({ reachable: false, status: 'OFFLINE', errorCode: 'REFUSED' });

    ssh.fail(/systemctl is-active/, e);
    const install = await request(app.getHttpServer())
      .post(`${url}/agent/install`)
      .set('Cookie', cookies)
      .expect(424);
    expect(install.body).toMatchObject({ statusCode: 424, errorCode: 'REFUSED' });
  });

  test('без куки — 401 на все шесть роутов', async () => {
    const base = '/api/v1/workspaces/01912345-6789-7abc-aef0-1234567890ab/servers';
    const sv = '01912345-6789-7abc-aef0-1234567890ac';
    await request(app.getHttpServer()).post(base).send({}).expect(401);
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).get(`${base}/${sv}`).expect(401);
    await request(app.getHttpServer()).post(`${base}/${sv}/test`).send({}).expect(401);
    await request(app.getHttpServer()).post(`${base}/${sv}/agent/install`).expect(401);
    await request(app.getHttpServer()).get(`${base}/${sv}/agent`).expect(401);
  });

  test('валидация до БД: неверный authType, лишнее поле, битый host, битый uuid', async () => {
    const { cookies, workspaceId } = await newWorkspace('e2e-third@example.com', 'e2ethird');
    const url = `/api/v1/workspaces/${workspaceId}/servers`;

    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({ name: 'x', host: '203.0.113.22', sshUsername: 'deploy', authType: 'PASSWORD' })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({ name: 'x', host: '203.0.113.22', sshUsername: 'deploy', authType: 'AGENT', sshPassword: 'secret1234' })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({ name: 'x', host: 'a; rm -rf /', sshUsername: 'deploy', authType: 'PASSWORD', sshPassword: 'secret1234' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/servers/not-a-uuid`)
      .set('Cookie', cookies)
      .expect(400);
    expect(await prisma.server.count({ where: { workspaceId } })).toBe(0);
  });

  test('чужой сервер и чужой workspace — 404, секрет наружу не утекает', async () => {
    const a = await newWorkspace('e2e-owner2@example.com', 'e2eowner2');
    const b = await newWorkspace('e2e-other@example.com', 'e2eother');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${a.workspaceId}/servers`)
      .set('Cookie', a.cookies)
      .send({ name: 'secret-1', host: '203.0.113.23', sshUsername: 'deploy', authType: 'PASSWORD', sshPassword: 'sup3rsecret' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${b.workspaceId}/servers/${created.body.id}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${a.workspaceId}/servers/${created.body.id}`)
      .set('Cookie', b.cookies)
      .expect(404);
    const visible = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${a.workspaceId}/servers/${created.body.id}`)
      .set('Cookie', a.cookies)
      .expect(200);
    expect(JSON.stringify(visible.body)).not.toContain('sup3rsecret');
  });
});
```

Запас по троттлингу: `authStrict` = 10/мин считается отдельно по каждому хэндлеру (`register` и `login` — разные хэндлеры, по 6 вызовов), лимит не должна быть превышена. Если тестов станет больше семи — добавь `process.env.THROTTLE_AUTH_STRICT_LIMIT = '50';` в тот же блок env, а не правь guard'ы.

- [x] **Step 2: Прогнать e2e**

Run в `app/backend`: `npx jest --config test/jest-e2e.json test/servers.e2e-spec.ts` — Expected: 8/8 PASS. `test/app.e2e-spec.ts` не трогать.

- [x] **Step 3: Живой SSH-smoke на одноразовом хосте**

Фикстура — в `/tmp`, не в репозитории. Проверено локально: docker 28.3.2, linux/aarch64, сокет на месте. Контейнер работает **под root**, поэтому `docker info` внутри него проходит, и префлайт доходит именно до проверки systemd (замечание ревью №13).

```bash
mkdir -p /tmp/bios-sshd-smoke && cat > /tmp/bios-sshd-smoke/Dockerfile <<'EOF'
FROM alpine:3.20
RUN apk add --no-cache openssh-server docker-cli sudo bash shadow \
 && ssh-keygen -A \
 && mkdir -p /run/sshd /root/.ssh \
 && echo 'root:P4ssw0rd-smoke' | chpasswd \
 && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config
EXPOSE 2222
CMD ["/usr/sbin/sshd", "-D", "-e", "-p", "2222"]
EOF
docker build -q -t bios-sshd-smoke /tmp/bios-sshd-smoke
docker run -d --name bios-sshd-smoke \
  -p 127.0.0.1:2202:2222 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  bios-sshd-smoke
docker exec bios-sshd-smoke docker info --format '{{.Server.Version}}'
docker exec bios-sshd-smoke sh -c 'command -v systemctl || echo NO_SYSTEMD'
```

Expected: `28.3.2` и `NO_SYSTEMD` — то есть у дымового теста заведомо рабочий Docker и заведомо отсутствующий systemd, и отказ install обязан быть про systemd, а не про Docker.

Сборка — foreground, запуск — отдельной командой в фон с PID, ожидание — через `GET /api/v1/health` (замечание ревью №12):

```bash
cd app/backend
export DATABASE_URL="postgresql://sabir@localhost:5432/bios_test_servers?schema=public" \
  NODE_ENV=development EMAIL_VERIFY_MX=false \
  SSH_ALLOWED_PORTS=22,2202 SSH_ALLOW_LOOPBACK=true \
  SERVER_CRYPTO_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
npm run build
node dist/main &
PANEL_PID=$!
for i in $(seq 1 40); do
  curl -sf localhost:3000/api/v1/health >/dev/null && break
  sleep 0.25
done
curl -sf localhost:3000/api/v1/health
```

Expected: `{"status":"ok","timestamp":…}`. Если цикл завершился без `{"status":"ok"}` — дымовой тест не продолжается, а разбирается причина (порт, `SERVER_CRYPTO_KEY`, `DATABASE_URL`).

Прогон шести роутов (куки в jar):

```bash
API=localhost:3000/api/v1
RUN_USER="smoke-$(date +%s)@example.com"
curl -s -X POST $API/auth/register -H 'content-type: application/json' \
  -d "{\"username\":\"smoke$(date +%s)\",\"email\":\"$RUN_USER\",\"password\":\"secret123\"}" >/dev/null
curl -s -c /tmp/jar -X POST $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$RUN_USER\",\"password\":\"secret123\"}" >/dev/null
WS=$(curl -s -b /tmp/jar -X POST $API/workspaces -H 'content-type: application/json' -d '{"name":"smoke"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
SRV=$(curl -s -b /tmp/jar -X POST $API/workspaces/$WS/servers -H 'content-type: application/json' \
  -d '{"name":"smoke-1","host":"127.0.0.1","port":2202,"sshUsername":"root","authType":"PASSWORD","sshPassword":"P4ssw0rd-smoke"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo '--- probe ---'; curl -s -b /tmp/jar -X POST $API/workspaces/$WS/servers/$SRV/test -H 'content-type: application/json' -d '{}'
FP=$(curl -s -b /tmp/jar $API/workspaces/$WS/servers/$SRV | node -pe 'JSON.parse(require("fs").readFileSync(0)).hostKeyFingerprint || "none"')
echo "pinned before confirm: $FP"
TRUST=$(curl -s -b /tmp/jar -X POST $API/workspaces/$WS/servers/$SRV/test -H 'content-type: application/json' \
  -d '{}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).hostKeyFingerprint')
echo '--- confirm+test ---'; curl -s -w '\n%{http_code}\n' -b /tmp/jar -X POST $API/workspaces/$WS/servers/$SRV/test \
  -H 'content-type: application/json' -d "{\"trustHostKey\":\"$TRUST\"}"
echo '--- agent status ---'; curl -s -w '\n%{http_code}\n' -b /tmp/jar $API/workspaces/$WS/servers/$SRV/agent
echo '--- install ---'; curl -s -w '\n%{http_code}\n' -b /tmp/jar -X POST $API/workspaces/$WS/servers/$SRV/agent/install
BAD — в **своём** воркспейсе: `@@unique([workspaceId, hostKeyFingerprint])` не даёт двум серверам одного воркспейса принять один и тот же отпечаток, а дымовой sshd один на оба случая.
```bash
WS2=$(curl -s -b /tmp/jar -X POST $API/workspaces -H 'content-type: application/json' -d '{"name":"smoke-bad"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
BAD=$(curl -s -b /tmp/jar -X POST $API/workspaces/$WS2/servers -H 'content-type: application/json' \
  -d '{"name":"smoke-bad","host":"127.0.0.1","port":2202,"sshUsername":"root","authType":"PASSWORD","sshPassword":"wrongpass123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
DUP=$(curl -s -b /tmp/jar -X POST $API/workspaces/$WS2/servers -H 'content-type: application/json' \
  -d '{"name":"smoke-bad-2","host":"127.0.0.1","port":2202,"sshUsername":"root","authType":"PASSWORD","sshPassword":"wrongpass123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
```
```

Expected — эти строки и есть доказательство, их вклеить в тело коммита:
- `probe` → `200` с `"trustRequired":true` и `"hostKeyFingerprint":"SHA256:…"`; при этом в выводе `ssh2`-сервера (логи контейнера: `docker logs bios-sshd-smoke 2>&1 | tail`) **нет** строки об успешной аутентификации — пароль не отправлялся;
- `confirm+test` → `200` с `"reachable":true,"status":"ONLINE","dockerVersion":"28.3.2"` — реальные TCP, KEX, аутентификация и `docker version`;
- `agent status` → `200` с `"status":"NOT_INSTALLED"` и `"errorCode":null` (`SD=missing`, манифеста нет — по таблице это действительно «не установлено»);
- `install` → `424` с `"errorCode":"SYSTEMD_MISSING"`;
- отдельно проверить отказ аутентификации: `curl … -X POST $API/workspaces/$WS2/servers/$BAD/test -d '{}'` → `200` с `"errorCode":"HOST_KEY_NOT_TRUSTED"` (первый контакт всегда probe), затем после подтверждения — `reachable:false,"errorCode":"AUTH_FAILED"`, а в логах sshd — `Failed password for root` (значит аутентификация реально была попыткой);
- `DUP` (второй сервер того же воркспейса, тот же отпечаток) → `409` с `host key already registered for another server`, а не `500`.

Что smoke **не** доказывает — зафиксировать в коммите, не выдавать за проверенное: успешная установка systemd-юнита требует хоста с systemd; локально такой среды нет. На реальном Linux-сервере (Ubuntu/Debian/Rocky) теми же шагами ожидается `201 INSTALLED` → `200 ACTIVE` → повторный `install` = `ALREADY_ACTIVE`. Пока это не сделано, метрика спринта «сервер `online` в UI» остаётся открытой (UI — вне части 3 по решению владельца).

Правки по прогону Task 11:

1. **Живой прогон опроверг утверждение Task 9 про пин.** Запись принятого отпечатка шла через `saveProbe()`, который превращает *любую* ошибку БД в 500; значит `P2002` по `@@unique([workspaceId, hostKeyFingerprint])` давал `500 server probe result could not be saved` вместо обещанного `409`. Исправлено отдельным `pinHostKey()` (P2002 → `mapConflict` → 409, прочее → 500), тест — «второй сервер воркспейса с тем же отпечатком → 409, а не 500». Ошибка живёт именно в том месте, где юнит-тесты не покрывали запись пина на реальный индекс: `mapConflict` существовал, но до него не доходили.
2. **`BAD` переехал в отдельный воркспейс** (`WS2`) — иначе его подтверждение упало бы на новый 409 и ветка `AUTH_FAILED` не была бы достигнута. `DUP` оставлен в `WS2` как раз ради проверки этого 409.
3. **Прогон не зависит от чужих данных**: пользователь регистрируется с уникальным email (`RUN_USER`), потому что общий `smoke@example.com` в `bios_test_servers` мог быть перезаписан параллельной работой в том же дереве.

- [x] **Step 4: Полный прогон и DoD-сверка**

Run в `app/backend`: `npx jest && npx jest --config test/jest-e2e.json test/servers.e2e-spec.ts && npm run build && npx prettier --check "src/**/*.ts" "test/**/*.ts" && npx eslint src/modules/servers src/modules/workspaces`.

| Требование `docs/mvp-scope.md` + ревью | Где доказано |
|---|---|
| `POST / GET .../servers` | Task 8 + e2e |
| `GET .../servers/:id` | Task 8 + e2e |
| `POST .../test` | Task 9 + e2e + живой smoke |
| `POST .../agent/install` | Task 10 + e2e + живой smoke (отказ по systemd) |
| `GET .../agent` | Task 10 + e2e + живой smoke |
| Prisma-модель | Task 1 |
| guard + workspace-scoping | Task 8/10 (`requireMembership`, 404-неотличимость) + e2e |
| e2e через куку `access_token` | Task 11 Step 1–2 |
| без заглушек `→ null/[]` | шесть роутов реальные; `docker/compose/git` — части 4–5 |
| host key до аутентификации | Task 6 (реальный ssh2-тест `authAttempts === 0`) + Task 9/11 |
| SSRF-политика | Task 5 (юнит) + Task 8/11 (TARGET_BLOCKED, PORT_NOT_ALLOWED) |
| install ≠ ноль кода скрипта | Task 10 (пять 424-сценариев после «успешного» скрипта) |
| ошибки БД ≠ ошибки транспорта | Task 9 (тест с подменой `prisma.server.update`) + `pinHostKey` (тест и живой smoke: дубль пина = 409, а не 500) |
| экранирование исполняемо | Task 7 (shell-песочница: payload в файле, `/tmp/…pwned` не создан) |

- [x] **Step 5: Убрать smoke-инфраструктуру**

```bash
kill $PANEL_PID
docker rm -f bios-sshd-smoke
rm -rf /tmp/bios-sshd-smoke /tmp/jar
git status --short
```

Expected: процесс панели остановлен по PID (не `pkill -f`), контейнер удалён, `git status` показывает только чужие правки из Task 0 Step 4 плюс свои закоммиченные файлы (чистые).

- [x] **Step 6: Коммит**

```bash
git add app/backend/test/servers.e2e-spec.ts
git commit -m "test(backend): e2e and ssh smoke for server onboard"
```

В тело коммита — вывод Step 3 (probe/confirm/agent/install/auth-отказ) и явная пометка, что install с активным юнитом проверен не был.

---

## Self-Review

1. **Spec coverage.** Все шесть эндпоинтов раздела «3. Server onboard»: Task 8 (1–3), Task 9 (4), Task 10 (5–6), Task 11 (e2e + smoke). Исключённое спеком (`PATCH/DELETE server`, `agent/upgrade`, `DELETE agent`, `connections`) не реализовано намеренно — в контроллере ровно шесть роутов, стабов нет. DoD — таблица Task 11 Step 4.
2. **Review coverage.** Все 13 замечаний разобраны в «Response to Review» и привязаны к задачам; ни одно не «перенесено в P1» молча, кроме явно названных (passphrase-PEM, IPv6, пул соединений, очередь задач агента) — они в Known gaps.
3. **Step scan.** «TBD/реализовать позже/аналогично Task N» нет. Каждый шаг — одно действие с командой и ожидаемым выводом; тесты и реализации даны кодом, правила — числами (`6/мин`, `staleSec=60`, `exit 42/43/45/46`, `Length(1,64)`, `32 байта`, `43 символа base64`).
4. **Type consistency.** `SshSession.address` появляется в Task 5/6 и используется в Task 8/9/10; `purpose: 'probe' | 'authenticated'` — единая сигнатура `loadForSsh` во всех задачах; `agentStatusOf` возвращает `{status, errorCode}` (Task 7) и так читается в Task 10; `TestServerDto` определён в Task 4 и применяется в Task 9/11; `FakeSshRunner.hostKey()` определён в Task 5 и используется в Task 9/11; `AgentReportStatus` из Task 1 импортируется в Task 10.
5. **Proportion.** План фиксирует решения (шов + host key + политика + протокол агента + разделение осей состояния + kid в cipher) и не раздувает их: пула, кэша, UI, очереди команд, пиннинга через внешний доверенный канал — нет.

## Known gaps (осознанные: принять или взять в P1)

- **Passphrase-ключи не поддерживаются**: `utils.parseKey` их распознаёт, сервис отвечает `400 encrypted private keys are not supported`.
- **`SSH_ALLOWED_PORTS` по умолчанию = [22]**: нестандартный порт сервера требует явной настройки; это осознанно строгое значение по умолчанию (политика важнее удобства).
- **Нет пула SSH-соединений и нет кэша:** `GET agent` = полный раунд-трип; для списочного UI (часть 4) нужен батч или кэш.
- **Write-on-read перевёртка ключа** в `loadForSsh` означает, что GET-путь может записать одну строку; альтернатива — офлайн-джоб миграции cipher, которого в MVP нет.
- **IPv6-литералы в `host` не принимаются** DTO (хотя политика их понимает) — противоречие зафиксировано, решение за владельцем в P1.
- **Подтверждение отпечатка — «в лоб»:** клиент показывает `hostKeyFingerprint` из probe-ответа и присылает его обратно; канал вне панели (out-of-band) для сверки не реализован, как и ротация принятого пина при смене ключа хоста (требует явного эндпоинта P1: сейчас несовпадение просто даёт `HOST_KEY_MISMATCH` + `OFFLINE`).
- **Один отпечаток = один сервер в воркспейсе** (`@@unique([workspaceId, hostKeyFingerprint])`): один и тот же sshd на двух портах (22 и 2202 в нашем же дымовом тесте) второй раз не подтверждается — клиент получает `409 host key already registered for another server`. Правило сознательное (ловит «два имени — один хост»), но для хостов с несколькими портами нужна либо его отмена, либо явный эндпоинт переиспользования пина.
- **«Агент» при SSH-транспорте — маркер с heartbeat**, а не исполнитель команд: реальный исходящий агент понадобится в частях 4–5 (стриминг логов, exec, пуш-метрики), и тогда `GET agent` станет читаться из его состояния, а не из `systemctl`.
- Стабы `DockerService.findContainers` (`return []`), `compose`, `git`, `projects`, `deployments` не тронуты — это части 4 и 5.

