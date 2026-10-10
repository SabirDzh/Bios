# ICC Frontend — матрица «фича → API» и гэпы

> Источник истины — код бэкенда (`app/backend/src/modules/*/**.controller.ts`,
> DTO, сервисы), а не `API.md`: в `API.md` перечислен весь бэклог (~110
> эндпоинтов), реализована лишь часть. Матрица составлена чтением кода
> (2026-10-10, коммит `dab1b45` + незакоммиченный срез deploy).
> Правило: чего нет в контроллерах — того нет в UI. Моков в интерфейсе нет,
> фикстуры — только в тестах и витрине примитивов (`/kit`).

## Стек (измерено)

| Слой | Что есть |
|---|---|
| Frontend | Vite 8 + React 19 + TS 6 (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`), oxlint, Tauri 2.11 (пустой каркас, `core:default`), существующий типизированный api-клиент (куки + single-flight refresh) |
| Backend | NestJS, префикс `/api/v1`, JWT RS256 в httpOnly-куках, Prisma/Postgres |
| Куки | `access_token` 600 c, `refresh_token` 604800 c, `SameSite=Lax` (dev), `Secure` только в prod, `credentials: true` в CORS |
| Refresh | Ротация с отзывом семейства: параллельный refresh убивает сессию → single-flight в клиенте обязателен (уже реализован) |
| Ошибки | `{statusCode, errorCode?, message, path, timestamp}`; `message` у валидации — массив строк; 424 — проблема зависимости с `errorCode` (SSH/docker); 504 `TIMEOUT`; 429 — троттлинг |
| Троттлинг | global 120/мин, `authStrict` 10/мин, `recovery` 5/мин, `invite` 30/мин, `sshOps` 6/мин, `dockerReads` 60/мин |
| Пагинация | workspaces/servers — курсор `{items, nextCursor}` (limit default 20); deployments — только `limit` (default 50, max 100), курсора нет; projects/configs — полные списки |
| Health | `GET /api/v1/health` → `{status:'ok', timestamp}` — для баннера «панель недоступна» |

## Роли

- `OWNER` / `MEMBER` (членство в workspace). Нет membership → 404 (без oracle),
  роль вне списка → 403.
- OWNER только: создание/инвайт workspace-сущностей (сервер, проект, конфиг,
  деплой, установка агента), рестарт контейнера.
- MEMBER: все чтения (серверы, контейнеры, логи, stats, проекты, деплои).

## Матрица (реализовано в контроллерах)

### Identity
| Фича | Endpoint | Тело/ответ | Роли | Статусы |
|---|---|---|---|---|
| Регистрация | `POST auth/register` | `{username, email, password}` → 201 User {id, username, email, canonicalEmail, confirmed:false, …} | — | 400 (дубль/валидация), 429 |
| Вход | `POST auth/login` | `{email, password}` → 200, пустое тело, куки | — | 401 «Unauthorized» (и email, и пароль), 429 |
| Сессия | `GET auth/me` | → `{userId, username, email, sid}` | JWT | 401 |
| Refresh | `POST auth/refresh` | 200, куки | cookie | 401 |
| Выход | `POST auth/logout`, `POST auth/revoke` | 200, куки очищены | JWT | 401 |
| Смена пароля | `PATCH users/change-password` | `{oldPassword, newPassword}` → 200 + куки очищены | JWT | 400, 401, 429 |
| Восстановление | `users/request-recovery`, `users/confirm`, `users/recovery` | токены в body (S3) | — | P1, UI в текущем срезе нет |

Примечания: `confirmed:false` — косметика, вход не блокирует (проверки `confirmed` нет).
`auth/email-verify` из `API.md` в коде отсутствует. Почта не отправляется нигде
(инфраструктуры email в коде нет) — токены выдаются в теле ответа.

### Workspaces
| Фича | Endpoint | Ответ | Роли | Статусы |
|---|---|---|---|---|
| Создать | `POST workspaces` | `{name}` → 201 Workspace {id, name, role, …} | — | 400 (name: `[\p{L}\p{N} _#-]{1,64}`), 429 |
| Список | `GET workspaces?cursor&limit` | `{items, nextCursor}` | — | 401 |
| Детали | `GET workspaces/:id` | Workspace | member | 404 |
| Пригласить | `POST workspaces/:id/invitations` | `{email}` → 201 Invitation **+ token (один раз)** | OWNER | 400, 403, 404, 409 «already a member», 429 (invite) |
| Принять | `POST workspaces/:id/accept` | `{token}` → 201 Membership | JWT, email приглашённого | 403 (чужой email), 404 (нет/истёк/ревокнут), 409 «already a member» |

TTL приглашения — `INVITATIONS_TTL_SEC`, default 86400 (1 сутки). Повторный
инвайт на тот же email ревокает предыдущий PENDING.

Гэпы (в коде нет): список участников, список/отзыв приглашений, смена роли,
удаление участника, PATCH/DELETE workspace, activity, settings.

### Servers
| Фича | Endpoint | Ответ | Роли | Статусы |
|---|---|---|---|---|
| Создать | `POST workspaces/:id/servers` | `{name, host, port?, sshUsername, authType: PASSWORD\|KEY, sshPassword?\|sshPrivateKey?}` → 201 | OWNER | 400 (порт вне `SSH_ALLOWED_PORTS` — деф. 22; ключ не парсится ssh2), 409 (имя/отпечаток занят), 429 |
| Список | `GET …/servers?cursor&limit` | `{items, nextCursor}` | member | 404 |
| Детали | `GET …/servers/:id` | ServerResponse | member | 404 |
| Проверка SSH | `POST …/servers/:id/test` | `{trustHostKey?}` → 200 `{reachable, trustRequired, status, latencyMs, dockerVersion, dockerErrorCode, errorCode, hostKeyFingerprint, checkedAt}` | member | 409 (пин не совпал), 424 (SSH-проблема), 429 (sshOps) |
| Статус агента | `GET …/servers/:id/agent` | `{status: NOT_INSTALLED\|FAILED\|STALE\|ACTIVE, version, installedAt, lastHeartbeatAt, errorCode, …}` | member | 424, 429 |
| Установка агента | `POST …/servers/:id/agent/install` | `{outcome: INSTALLED\|ALREADY_ACTIVE, agent}` | OWNER | 424 (errorCode из префлайта), 429 |

TOFU-поток: первый `test` без пина → `trustRequired:true` + отпечаток →
подтверждение `trustHostKey=<отпечаток>` → пин + docker-версия. `errorCode` —
словарь `SshErrorCode` (26 значений, см. план). Статусы сервера: PENDING / ONLINE / OFFLINE.

Гэпы: PATCH/DELETE сервера, upgrade/delete агента, история подключений
(`connections`). Секреты (пароль/ключ) не читаются никогда — ни одного эндпоинта.

### Docker (контейнеры)
| Фича | Endpoint | Ответ | Роли | Статусы |
|---|---|---|---|---|
| Список | `GET …/docker/containers?all=true\|false` | ContainerSummary[] | member | 424 (DOCKER_*), 429 (dockerReads) |
| Детали | `GET …/containers/:containerId` | ContainerDetails (порты, health, labels, restartCount, oomKilled) | member | 404, 424, 429 |
| Логи | `GET …/containers/:id/logs?tail&timestamps&since` | `{lines[{stream,text}], truncated, limitBytes, tty}` — снимок, не follow; tail ≤10000, default 200; бюджет байт на бэкенде | member | 404, 424, 429, 504 |
| Нагрузка | `GET …/containers/:id/stats` | `{cpuPercent, memoryUsageBytes/Limit, netRx/Tx, blkRead/Write, readAt}` — one-shot ~1 c, значения nullable | member | 404, 424, 429, 504 |
| Перезапуск | `PATCH …/containers/:id` | `{action:'restart'}` → `{containerId, action, state, startedAt}` | **OWNER** | 404, 424, 429 (sshOps), 504 |

Гэпы: exec/shell, ресурсы (PUT resources), удаление контейнера, история,
docker events (поток), volumes/networks/images, compose (контроллер-заглушка).

### Deploy
| Фича | Endpoint | Ответ | Роли | Статусы |
|---|---|---|---|---|
| Создать проект | `POST …/projects` | `{name, repoUrl}` → 201 Project | OWNER | 400 (публичный https-репо: без credentials/приватных хостов), 409 (имя занято) |
| Проекты | `GET …/projects`, `GET …/projects/:id` | Project[] / Project | member | 404 |
| Создать конфиг | `POST …/projects/:id/deploy-configs` | `{name, method:'GIT_PULL', ref, dockerfile?, containerName, ports?, serverId}` → 201 | OWNER | 400 (ref — ветка/тег без `.. ~ ^ {`; dockerfile — относительный путь; containerName по правилам docker; порты `host:container[/tcp]`, host-порт уникален), 404 (сервер не в workspace), 409 (имя конфига / containerName занят на сервере) |
| Конфиги | `GET …/projects/:id/deploy-configs` | DeployConfig[] | member | 404 |
| Запустить деплой | `POST …/deployments` | `{projectId, configId}` → **202** Deployment | OWNER | 404, 409 «уже в очереди или выполняется», 429 (sshOps) |
| История | `GET …/deployments?projectId&configId&limit` | Deployment[] (createdAt desc, без курсора) | member | 404 |
| Детали деплоя | `GET deployments/:id` | Deployment | member | 404 |
| Логи деплоя | `GET deployments/:id/logs` | `{log, finished, sizeBytes, status}` — polling, не WS | member | 404 |

Деплой: статусы `QUEUED → RUNNING → SUCCESS/FAILED`, `INTERRUPTED` — только
`reconcile` при рестарте панели. Шаги `preflight→source→build→run` в поле `step`.
`errorCode` — словарь `DeployErrorCode` (19 значений). `durationMs` — готовое
поле. Нет отмены, нет повтора, нет расписаний/истории конфигурации,
PATCH/DELETE конфигов — гэпы. Логи деплоя — хвост шагов, лимит `deploy.logTailBytes`.

### Git / Compose / остальное из `API.md`
Контроллеры `git` и `compose` — пустые классы без маршрутов. Integrations,
репозитории, PR/issue/actions/artifacts, images pull/build/import/export,
volumes, networks, members CRUD, users PATCH/DELETE, серверные
upgrade/delete/connections, deploy schedules/history, notifications, поиск —
**в коде отсутствуют**. В UI не проектируются до реализации API.

## Следствия для фронтенда

1. **Инвайт без почты.** Владелец получает токен один раз и передаёт вручную.
   UI: показ токена + копирование пары «workspaceId + token», страница приёма
   `/join/:workspaceId/:token` (и ручной ввод). Список участников показать нечем —
   не рисуем.
2. **Лимиты SSH-операций (6/мин).** Кнопки «Проверить», «Установить агента»,
   «Перезапустить» — с блокировкой на время запроса и честной обработкой 429.
3. **Логи — снимки.** Контейнерные логи не follow: ручное обновление +
   предупреждение `truncated`. Логи деплоя — polling от 2 c, `finished` решает,
   когда остановить.
4. **stats ~1 c на бэкенде** → отдельный спиннер, интервал ручной или редкий.
5. **Неизвестные статусы показываем как есть** (например, `state` контейнера, `created`),
   не подменяем своими.
6. **Валидация зеркалится на клиенте** там, где правило известно (имя 1–64
   `[\p{L}\p{N} _#-]`, username `[a-z0-9._-]{3,64}`, пароль 8–128 без пробелов,
   ref/dockerfile/containerName/порты) — серверные сообщения показываем как
   fallback, коды 409/403/404/424/429 маппим в русский текст.
7. **Отпечаток хоста** (`SHA256:…`) и все технические значения — моноширинным.
