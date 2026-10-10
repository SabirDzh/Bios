# Bios — MVP Scope: 20% функциональности = 80% ценности

> Решение владельца продукта (Scrum). Полный бэклог — `API.md` (~110 эндпоинтов).
> Здесь зафиксирован минимум, дающий рабочий продукт.

## Product Goal

За 15 минут от регистрации до первого рабочего контейнера на своём сервере.

Персоны: solo-dev / малая команда без DevOps.

## P0 — MVP (ядро ценности, ~22 эндпоинта)

### 1. Identity (4)
- `POST auth/register`
- `POST auth/login`
- `GET auth/me`
- `POST auth/refresh`

### 2. Workspace минимум (5)
- `POST / GET workspaces` — создать / список
- `GET workspaces/:id` — детали
- `POST .../invitations` + `POST .../accept` — пригласить / принять

Без `activity/settings/members-CRUD` — отложить.

### 3. Server onboard — aha-moment (6)
- `POST / GET .../servers` — добавить / список
- `GET .../servers/:id` — детали
- `POST .../test` — проверка SSH-подключения
- `POST .../agent/install` + `GET .../agent` — установка и статус агента

Без `upgrade/delete-agent/connections-history` — P1.

### 4. Docker operate (5)
- `GET .../containers` — список
- `GET .../containers/:id` — детали
- `GET .../logs` — логи
- `GET .../stats` — нагрузка
- `PATCH .../containers/:id` — restart/recreate

Без `exec/volumes/networks/images` на MVP.

### 5. Deploy минимум (6–7)
- `POST / GET .../projects` — создать / список проектов
- `GET / POST .../deploy-configs` — конфигурация деплоя
- `POST .../deployments` — ручной деплой
- `GET deployments/:id` + `GET .../logs` — статус и логи

Без `schedules/history/config-CRUD` на MVP.

## P1 — Next (после MVP)

`users/me`, `servers PATCH/DELETE`, `images list/pull`, `compose list/detail/logs`,
история деплоев, `members/roles`, `containers exec/resources`.

## P2 — Later

`volumes/networks`, `images build/import/export`, `git branches/commits/pulls/diff`,
`compose import/update/status`, `schedules`.

## Won't (P3)

`git issues/releases/tags/files/tree/compare/actions/jobs/artifacts` (`API.md:90-106`) —
клон GitHub UI, нулевая ценность для деплоя. Выпилить из бэклога.

## Спринты (velocity ~15–20 SP, 2 недели)

| Спринт | Содержание | Done / метрика |
|---|---|---|
| 1. Доступ | auth по спеку + `workspaces CRUD + invite/accept` | новый юзер создаёт workspace и приглашает второго; регистрация < 2 мин |
| 2. Сервер | `servers CRUD + test + agent/install + status` | сервер `online` в UI; подключение < 5 мин |
| 3. Видимость | `containers list/detail/logs/stats + restart` | упавший контейнер и логи видны без SSH |
| 4. Деплой | `projects + deploy-config + manual deploy + logs` | `git push → deploy → logs`; первый деплой < 10 мин |

## Definition of Done (P0)

Endpoint + Prisma-модель + guard/workspace-scoping + e2e через куки
`access_token`, без заглушек `→null/[]`.

## Риски

Схема БД отстаёт от модулей: без моделей
`Workspace/Server/Project/Deployment` спринты 1–2 встанут — начинать с миграции.
