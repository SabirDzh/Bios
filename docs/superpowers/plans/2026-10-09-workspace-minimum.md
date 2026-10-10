# Workspace минимум (MVP часть 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 5 эндпоинтов Workspace-минимума из MVP: создание/список/детали воркспейса, приглашение по email, принятие приглашения.

**Architecture:** Prisma-модели `Workspace` + `WorkspaceMember` + `WorkspaceInvitation` (PostgreSQL); вся бизнес-логика в `WorkspacesService` с транзакциями; контроллер тонкий, все роуты под `JwtAuthGuard`; скоупинг по membership внутри сервиса (чужой `workspaceId` всегда 404, без oracle).

**Tech Stack:** NestJS 11, Prisma 6.19.3, PostgreSQL 18, class-validator, jest + ts-jest (интеграционные тесты на живой PG).

**Spec:** `docs/mvp-scope.md` (раздел «2. Workspace минимум»), детали роутов — `API.md:13-24` (берём только create/list/get/invite/accept; `activity/settings/members-CRUD/PATCH/DELETE` — вне скоупа).

## Global Constraints

- Node 26; `npm run build` (nest build) обязан проходить после каждой задачи.
- id всех новых строк — `String @id @default(uuid(7))`; все `DateTime` — `@db.Timestamptz(3)`.
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` глобален — каждый DTO валидируется полностью, лишние поля = 400.
- Аутентификация — только `JwtAuthGuard` (кука `access_token`); текущий юзер — `@User() user: JwtUserPayload` (`user.userId`).
- Ошибки — только Nest `HttpException` (envelope строит `AllExceptionsFilter`).
- Никаких заглушек и TODO: `sendInvitationMail` НЕ создавать — токен приглашения возвращается в ответе (отправка писем вне скоупа).
- Тесты БД: у каждого spec-файла своя база (паттерн `auth-rotation.spec.ts` → `bios_test`); воркспейсам — новая `bios_test_workspaces`; `afterEach` чистит таблицы в порядке FK.
- Rate limit: глобальный 120/min уже есть; на `POST invitations` повесить `@Throttle({ default: { limit: 30, ttl: 60_000 } })` — 30 запросов/мин (ttl у throttler v6 в миллисекундах, сверено с использованием в `auth.controller.ts`).
- Токен приглашения — НЕ uuid: `crypto.randomBytes(32).toString('base64url')` (43 символа), в БД только SHA-256 hex (`tokenHash @unique`), открытый токен возвращается только в ответе на создание; плейнтекст в БД не хранится никогда.
- Ответы API — явные публичные шейпы (`WorkspaceResponse { id, name, role, createdAt, updatedAt }`, `InvitationResponse { id, workspaceId, email, status, expiresAt, createdAt }` + `token` только в ответе create, `MembershipResponse`), сырые Prisma-сущности наружу не возвращать.
- Email нормализуется одинаково везде (`trim().toLowerCase()` — как уже делает `UsersService`); `invite.email` сверяется с `user.email` после нормализации; подтверждённый email (`confirmed`) НЕ требуется — осознанно, консистентно с login.
- Инвайт существующему участнику → `409` (явное бизнес-правило MVP).
- CSRF: отдельной Origin-проверки не добавляем — принятая поза проекта (куки `SameSite=Lax`, как зафиксировано в JWT-отчёте); `JwtAuthGuard` + Lax покрывают браузерный вектор.
- Маппинг ошибок (строго): pre-existing membership → `409`; инвайт consumed/expired/invalid → `404`; неизвестный Prisma-конфликт (`P2002` не на membership) → не маскировать, пусть падает 500 с логом.
- В спеках PrismaService инстанцировать только в `beforeAll` (никогда на уровне модуля), `DATABASE_URL` — первой строкой spec-файла; Task 0 включает grep-проверку этого.
- Сообщения об ошибках на русском не писать; тексты как в существующих DTO (английский, нижний регистр начала).
- Prettier + eslint по touched-файлам после каждой задачи; коммит в конце каждой задачи.

## Review Focus

1. Два параллельных `accept` одним токеном → второй обязан получить 404 (claim не выигран, инвайт уже не PENDING), без дубля membership (тест в Task 4).
2. Два параллельных `invite` на один email → ровно один 201, второй 409 (partial unique index), ретрай второго после этого видит supersede-состояние (тест в Task 4).
3. Принятие просроченного приглашения → 404 наружу, а в БД запись атомарно переходит PENDING→EXPIRED (тест в Task 4 проверяет оба факта).
4. Не-участник подбирает `workspaceId` → 404, неотличимый от «нет такого воркспейса»; плейнтекст токена нигде в БД/ответах кроме create-ответа (тесты в Task 3/4).
5. Имя из одних пробелов / 65 символов / email без `@` в инвайте / токен неверного формата (не 43 base64url-символа) → 400 до касания БД (тесты в Task 2).

---

## File Structure

- Modify: `app/backend/prisma/schema.prisma` — добавить `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, enum `WorkspaceRole { OWNER, MEMBER }`, enum `InvitationStatus { PENDING, ACCEPTED, REVOKED, EXPIRED }`, связь `User.refreshSessions`-стиля: `User.workspaces WorkspaceMember[]`, `User.sentInvitations WorkspaceInvitation[]`.
- Modify: `app/backend/src/modules/workspaces/workspaces.module.ts` — импорты `PrismaModule`; экспорт `WorkspacesService` (понадобится частям 3 и 5).
- Create: `app/backend/src/modules/workspaces/dto/create-workspace.dto.ts` — `CreateWorkspaceDto`.
- Create: `app/backend/src/modules/workspaces/dto/workspace-id.dto.ts` — `WorkspaceIdDto`.
- Create: `app/backend/src/modules/workspaces/dto/invite-member.dto.ts` — `InviteMemberDto`.
- Create: `app/backend/src/modules/workspaces/dto/accept-invitation.dto.ts` — `AcceptInvitationDto`.
- Modify: `app/backend/src/modules/workspaces/workspaces.service.ts` — вся логика (сигнатуры ниже).
- Modify: `app/backend/src/modules/workspaces/workspaces.controller.ts` — 5 роутов, удалить стабы `update/remove`.
- Create: `app/backend/src/modules/workspaces/dto/*.spec.ts` (один файл `dto.spec.ts`) — unit-тесты валидации.
- Create: `app/backend/src/modules/workspaces/workspaces.spec.ts` — интеграционные тесты на `bios_test_workspaces`.

## Interfaces

```ts
// workspaces.service.ts
create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceResponse>;
findAllForUser(userId: string): Promise<WorkspaceResponse[]>;
findOneForUser(userId: string, workspaceId: string): Promise<WorkspaceResponse>;
invite(inviterId: string, workspaceId: string, email: string): Promise<InvitationCreateResponse>;
accept(userId: string, workspaceId: string, token: string): Promise<MembershipResponse>;

// Публичные шейпы (сырые Prisma-модели наружу не возвращать):
// WorkspaceResponse { id, name, role, createdAt, updatedAt }
// InvitationCreateResponse { id, workspaceId, email, status, expiresAt, createdAt, token }
// MembershipResponse { id, workspaceId, userId, role, joinedAt }
```

Правила скоупинга (единые для всех методов): нет membership → `NotFoundException` (404), без различия «нет доступа / нет объекта». `invite` дополнительно: роль не OWNER → `ForbiddenException` (403).

Модель инвайта: `token` — uuid7 unique (возвращается в ответе, одноразовый); `expiresAt = now + 7d`; `status` по умолчанию PENDING.

---

### Task 0: Тестовая БД и синхронизация миграций

**Files:** нет (инфра, выполняется в shell).

- [ ] **Step 1: Создать БД и прогнать миграции везде**

```bash
psql -h localhost -U sabir -d postgres -c "CREATE DATABASE bios_test_workspaces;"
export DATABASE_URL="postgresql://sabir@localhost:5432/bios_test_workspaces?schema=public"
npx prisma migrate deploy --schema=prisma/schema.prisma
```

Run в `app/backend`. Expected: `All migrations have been successfully applied`, таблицы `User/Token/RefreshSession` на месте.

- [ ] **Step 2: Проверить отсутствие module-scope инициализации Prisma в спеках**

Run в `app/backend`:

```bash
grep -rn "new PrismaService" src --include="*.spec.ts"
```

Expected: совпадения только внутри `beforeAll`/`beforeEach`-блоков (как в `auth-rotation.spec.ts`); `DATABASE_URL` присваивается первой строкой spec-файла до любых инстанцирований.

- [ ] **Step 3: Коммит не нужен** (инфра вне репозитория; шаг без коммита).

---

### Task 1: Prisma-модели и миграция

**Files:**
- Modify: `app/backend/prisma/schema.prisma`
- Test: `psql` + `npx prisma migrate dev`

**Interfaces:**
- Produces: модели `Workspace`, `WorkspaceMember`, `WorkspaceRole`, `WorkspaceInvitation`, `InvitationStatus` (имена точь-в-точь).

- [ ] **Step 1: Добавить модели в `schema.prisma`**

```prisma
model Workspace {
  id          String               @id @default(uuid(7))
  name        String
  createdAt   DateTime             @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime             @updatedAt @db.Timestamptz(3)
  members     WorkspaceMember[]
  invitations WorkspaceInvitation[]
}

model WorkspaceMember {
  id          String        @id @default(uuid(7))
  workspaceId String
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        WorkspaceRole @default(MEMBER)
  joinedAt    DateTime      @default(now()) @db.Timestamptz(3)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model WorkspaceInvitation {
  id          String           @id @default(uuid(7))
  workspaceId String
  workspace   Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  email       String
  tokenHash   String           @unique
  status      InvitationStatus @default(PENDING)
  invitedById String
  invitedBy   User             @relation("SentInvitations", fields: [invitedById], references: [id], onDelete: Cascade)
  expiresAt   DateTime         @db.Timestamptz(3)
  createdAt   DateTime         @default(now()) @db.Timestamptz(3)

  @@index([workspaceId, status])
}
```

В `User` добавить `members WorkspaceMember[]` и `sentInvitations WorkspaceInvitation[] @relation("SentInvitations")`. `ownerId` на `Workspace` НЕ добавлять (владение = membership с ролью OWNER).

- [ ] **Step 2: Миграция на dev-БД через --create-only (нужен ручной SQL) и синхронизация тестовых**

```bash
export DATABASE_URL="postgresql://sabir@localhost:5432/bios?schema=public"
npx prisma migrate dev --name workspaces --create-only --schema=prisma/schema.prisma
```

Затем дописать в созданный `migration.sql` partial unique index (Prisma его не умеет) — ровно одну строку:

```sql
CREATE UNIQUE INDEX "WorkspaceInvitation_workspace_email_pending_key"
  ON "WorkspaceInvitation"("workspaceId", "email")
  WHERE "status" = 'PENDING'::"InvitationStatus";
```

Затем применить и синхронизировать тестовые БД:

```bash
npx prisma migrate dev --schema=prisma/schema.prisma
for db in bios_test bios_test_maintenance bios_test_workspaces; do
  export DATABASE_URL="postgresql://sabir@localhost:5432/$db?schema=public"
  npx prisma migrate deploy --schema=prisma/schema.prisma
done
```

Run в `app/backend`. Expected: везде `up to date`; индекс виден в `\d "WorkspaceInvitation"` базы `bios`.

- [ ] **Step 3: Проверить клиент и сборку**

Run: `npm run build` в `app/backend`. Expected: чисто.

- [ ] **Step 4: Коммит**

```bash
git add app/backend/prisma/schema.prisma app/backend/prisma/migrations/*workspaces*
git commit -m "feat(backend): add workspace, member and invitation models"
```

---

### Task 2: DTO и unit-тесты валидации

**Files:**
- Create: `dto/create-workspace.dto.ts`, `dto/workspace-id.dto.ts`, `dto/invite-member.dto.ts`, `dto/accept-invitation.dto.ts`
- Test: `dto/dto.spec.ts` (validate через class-validator, без БД)

**Interfaces:**
- Produces: `CreateWorkspaceDto { name }`, `WorkspaceIdDto { workspaceId }`, `InviteMemberDto { email }`, `AcceptInvitationDto { token }`.

- [ ] **Step 1: Написать падающий тест `dto/dto.spec.ts`**

```ts
// name из пробелов и длиной 65 -> ошибка валидации; 'ab' валидно
// workspaceId не-uuid и uuid v4 -> ошибка; uuid v7 валиден (паттерн find-*.dto.ts)
// accept token: uuid и строка длиной != 43 -> ошибка; 43 base64url-символа валидно
// invite email 'no-at-sign' -> ошибка; 'a@b.cd' валидно (shape-only, без disposable/MX)
```

Точные правила: `name` — `@Transform(trim)` + `@Length(1, 64)`; `workspaceId` — `@IsUUID('7')`; invite `email` — `@Transform(lower+trim)` + `@MinLength(6)` + `@MaxLength(254)` + `@Matches(/^\S+@\S+\.\S+$/)`, без `@IsNotDisposableEmail/@IsDeliverableEmail` (осознанно: инвайт шлёт человек, политику почты не навязываем); accept `token` — `@IsString()` + `@Matches(/^[A-Za-z0-9_-]{43}$/)` (ровно 43 base64url-символа = 32 байта секрета, НЕ uuid).

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest src/modules/workspaces/dto/dto.spec.ts` в `app/backend`. Expected: FAIL (DTO не существуют).

- [ ] **Step 3: Создать 4 DTO по правилам выше.**

- [ ] **Step 4: Тесты зелёные**

Run: та же команда. Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add app/backend/src/modules/workspaces/dto/
git commit -m "feat(backend): add workspace DTOs with validation"
```

---

### Task 3: create / list / get + guard + интеграционные тесты

**Files:**
- Modify: `workspaces.service.ts` (методы `create`, `findAllForUser`, `findOneForUser`), `workspaces.controller.ts` (3 роута, удалить стабы `update/remove`), `workspaces.module.ts` (imports `[PrismaModule]`, exports `[WorkspacesService]`)
- Test: `workspaces.spec.ts` (реальная `bios_test_workspaces`, хелпер создания юзера через `UsersService`)

**Interfaces:**
- Consumes: `JwtAuthGuard`, `@User()`, DTO из Task 2, `PrismaService`.
- Produces: `POST /workspaces → 201`, `GET /workspaces → 200[]`, `GET /workspaces/:workspaceId → 200/404`.

- [ ] **Step 1: Написать падающие интеграционные тесты**

```ts
// POST create: создатель получает роль OWNER; ответ содержит id+name+role
// GET list: юзер видит 2 своих воркспейса и не видит чужой
// GET one: чужой workspaceId -> 404; случайный uuid7 -> 404 (неотличимо)
// GET one без куки -> 401
```

Сетап как в `auth-rotation.spec.ts`: `process.env.DATABASE_URL` на `bios_test_workspaces` первой строкой файла; `afterEach` — `deleteMany` в порядке `WorkspaceInvitation → WorkspaceMember → Workspace → Token → RefreshSession → User`.

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest src/modules/workspaces/workspaces.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать сервис и контроллер**

`create` — интерактивная транзакция (array-форма `$transaction([...])` не подходит: id workspace нужен для membership):

```ts
return this.prisma.$transaction(async (tx) => {
  const workspace = await tx.workspace.create({ data: { name: dto.name } });
  await tx.workspaceMember.create({
    data: { workspaceId: workspace.id, userId, role: 'OWNER' },
  });
  return { ...toWorkspaceResponse(workspace), role: 'OWNER' as const };
});
```

`findAllForUser`: `member.findMany({ where: { userId }, include: { workspace: true } })` → маппинг в `WorkspaceResponse + role`. `findOneForUser`: `member.findUnique({ where: { workspaceId_userId } })` → нет → 404. Контроллер: `@UseGuards(JwtAuthGuard)` на классе; `@Param()` принимать DTO целиком (`@Param() dto: WorkspaceIdDto` — строковая форма `@Param('workspaceId')` обходит ValidationPipe); `@Throttle` не добавлять (хватает глобального 120/min). Удалить `update/remove` из контроллера и сервиса.

- [ ] **Step 4: Зелёные тесты + проверки**

Run: `npx jest src/modules/workspaces/`, `npm run build`, `npx prettier --check`, `npx eslint` по touched-файлам. Expected: всё чисто.

- [ ] **Step 5: Коммит**

```bash
git add app/backend/src/modules/workspaces/
git commit -m "feat(backend): workspace create, list and guarded details"
```

---

### Task 4: invitations + accept + гонки и сроки

**Files:**
- Modify: `workspaces.service.ts` (`invite`, `accept`), `workspaces.controller.ts` (`POST :id/invitations`, `POST :id/accept`)
- Test: дополнить `workspaces.spec.ts`

**Interfaces:**
- Consumes: всё из Task 3.
- Produces: `POST :id/invitations → 201 {invitation с token}`, `POST :id/accept → 201 {membership}`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// invite: OWNER создает инвайт (201, token из 43 base64url-символов, status PENDING); MEMBER -> 403; чужой workspace -> 404
// invite: в БД лежит только tokenHash (sha256 hex), плейнтекста нет (проверить сырым запросом); инвайт участнику -> 409
// invite: второй инвайт на тот же email supersede'ит первый (старый token -> 404)
// invite: два параллельных invite на один email -> ровно один 201, второй 409
// accept: валидный token -> 201 membership MEMBER; повторный accept тем же token -> 404 (токен одноразовый)
// accept: просроченный token -> 404 наружу + в БД запись PENDING→EXPIRED; token другого воркспейса -> 404
// accept: invite.email != user.email (после lower+trim с обеих сторон) -> 403
// accept: два параллельных accept одним token -> ровно один 201, второй 404, дубля membership нет
// accept несуществующим юзером невозможен по определению (guard) — не тестируем
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest src/modules/workspaces/workspaces.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать**

`invite` (интерактивная транзакция, email предварительно нормализован `trim().toLowerCase()`):
1. membership+роль вне транзакции (нет → 404, не OWNER → 403); email уже участник → 409.
2. В транзакции: старые PENDING с истёкшим `expiresAt` → EXPIRED, остальные PENDING этого email → REVOKED (supersede); создать новый (`token = crypto.randomBytes(32).toString('base64url')`, хранить `sha256(token)`, `expiresAt = now + 7d`).
3. Вернуть `InvitationCreateResponse` (включая открытый `token` — отправки писем нет). Гонка двух параллельных invite упирается в partial unique index → Prisma `P2002` маппить в `409` (клиент ретраит).
`accept` (интерактивная транзакция, atomic claim как в `SessionsService.rotate`):
1. `invitation.updateMany({ where: { tokenHash: sha256(token), workspaceId, status: PENDING, expiresAt: { gt: now } }, data: { status: ACCEPTED } })` — `count === 1` выигрывает; иначе классификация: нет записи → 404; запись есть, но EXPIRED/ACCEPTED/REVOKED или `expiresAt <= now` (атомарно перевести PENDING→EXPIRED) → 404; email mismatch (нормализованный) → 403; membership уже есть → 409.
2. В той же транзакции `member.create(MEMBER)`. `P2002` на `member.create` → 409 (единственный реалистичный конфликт здесь — membership; tokenHash-коллизия практически невозможна; любой другой constraint — не маскировать, пусть 500 с логом).

- [ ] **Step 4: Зелёные тесты + полная проверка модуля**

Run: `npx jest`, `npm run build`, prettier/eslint по touched. Expected: 40+ новых — все PASS, регрессий нет.

- [ ] **Step 5: Коммит**

```bash
git add app/backend/src/modules/workspaces/ app/backend/prisma/
git commit -m "feat(backend): workspace invitations and accept flow"
```

---

### Task 5: Сквозная проверка и DoD

**Files:** нет (проверки + живой smoke).

- [ ] **Step 1: Полный локальный прогон**

Run в `app/backend`: `npx jest`, `npm run build`, `npx prettier --check "src/**/*.ts"`, `npx eslint src/modules/workspaces/`. Expected: всё чисто.

- [ ] **Step 2: Живой smoke через HTTP**

Поднять `dist/main` на `bios_test`, прогнать: register → login → `POST /workspaces` (201) → `GET /workspaces` (виден) → invite второго юзера (201, взять token) → accept вторым юзером (201) → повторный accept (404) → `GET` чужим юзером (404). Почистить тестовые данные SQL. Expected: статусы как в скобках.

- [ ] **Step 3: Коммит не нужен** (шаг верификации; при расхождении — баг-фикс отдельной задачей, не молча).

---

## Self-Review

1. **Spec coverage:** все 5 эндпоинтов раздела 2 спека покрыты задачами 3–4; `activity/settings/members/PATCH/DELETE` исключены по спеку; DoD (модель+guard+скоупинг+e2e, без заглушек) закрыт задачами 1/3/4/5. Дополнительно покрыто ревью: bearer-токен инвайта (SHA-256 + только-create-ответ), EXPIRED-переход, supersede-гонки, P2002-маппинг, `@Param()`-DTO форма, отсутствие mailer-стаба.
2. **Step scan:** каждый шаг — одно действие с проверяемым результатом; команды и expected-выходы указаны; транскриптов тел функций нет (только сигнатуры и правила).
3. **Type consistency:** имена `Workspace/WorkspaceMember/WorkspaceInvitation/WorkspaceRole/InvitationStatus`, методы сервиса и DTO одинаковы во всех задачах; `role` в ответах create/list/get — везде.
4. **Review Focus:** 5 пунктов выше, каждый привязан к тесту в Task 2/3/4.
5. **Proportion:** план фиксирует только решения (скоупинг-404, supersede инвайтов, email-match, 409/403/404-семантика, отдельная тестовая БД, отсутствие mailer-стаба) — тел функций не содержит.
