# AppConfig: единый центр конфигурации Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один проверенный источник всех настроек (`loadAppConfig()`), ноль скрытых чтений `process.env` в модулях, поведение приложения не меняется (миграционные тесты это доказывают).

**Architecture:** Новый глобальный `AppConfigModule` (синглтон-загрузка при импорте) раздаёт типизированный `APP_CONFIG`; существующий `AUTH_CONFIG` строится из него через `toAuthConfig` (двойной загрузки ключей нет); throttle — 4 именованных профиля через `forRootAsync` + `skipIf` по метаданным; cron — динамическая регистрация в `SchedulerRegistry`.

**Tech Stack:** NestJS 11, @nestjs/throttler v6, @nestjs/schedule v5 (+ транзитивный `cron`), Prisma 6.19.3.

**Spec:** ревью владельца продукта в треде (таблица fail-fast, единицы `ttlMs`, границы `AppConfig/AUTH_CONFIG/auth-cookies`, удаление legacy, миграционные тесты).

## Global Constraints

- Ветка `dev`; `npm run build` зелёный после каждой задачи; коммит в конце каждой задачи.
- `process.env` читает ТОЛЬКО `src/config/app.config.ts` (верификация: `grep -rn "process\.env" src --include="*.ts" | grep -v spec` → только этот файл).
- Никаких `parseInt(x) || default`: отсутствие переменной и невалидное значение различаются (второе всегда throw).
- Значения по умолчанию = текущие захардкоженные (перечислены в Task 1, сверка тестом).
- Prettier/eslint по touched-файлам; jest после каждой задачи.

## Review Focus

1. Throttle-профиль на строгом роуте не должен суммироваться с лишними (семантика: global + выбранный профиль, effective = min; проверить e2e-тестом на 429).
2. `SameSite=None` без `Secure` обязан ронять старт; `secure` в dev=false, в prod=true (тест обеих веток).
3. `CORS_ORIGINS` отсутствует в production → старт падает, а не открывается (тест).
4. Cron из env реально применяется (не зашит декоратором): тест проверяет зарегистрированную задачу в `SchedulerRegistry` (cron + timezone).
5. `AUTH_CONFIG` после рефакторинга побайтово эквивалентен прямому `loadAuthConfig` (fingerprint/TTL/iss/aud в тесте).

## File Structure

- Create: `src/config/app.config.ts` — типы, `APP_CONFIG`, `loadAppConfig()`, все валидаторы.
- Create: `src/config/app-config.module.ts` — глобальный модуль, `const appConfig = loadAppConfig()` один раз на импорт, `useValue`, экспорт символа и значения.
- Create: `src/common/throttle/throttle-profile.decorator.ts` — ключ + `ThrottleProfile(name)`.
- Modify: `src/modules/auth/auth.config.ts` — `loadAuthConfig(env)` с обязательным env (убрать дефолт), добавить `toAuthConfig(app)`.
- Modify: `src/modules/auth/auth.module.ts` — `AUTH_CONFIG` через `useFactory` + `inject: [APP_CONFIG]`.
- Modify: `src/app.module.ts` — `AppConfigModule`, `ThrottlerModule.forRootAsync` (4 профиля + `skipIf`), глобальный guard остаётся.
- Modify: `src/main.ts` — порт/CORS из импортированного синглтона `appConfig`, не из `process.env`.
- Modify: контроллеры auth/users/workspaces — `@Throttle({...})` → `@ThrottleProfile('authStrict'|'recovery'|'invite')`.
- Modify: `src/modules/auth/auth-cookies.ts` — экспорт `ACCESS_COOKIE_NAME`/`REFRESH_COOKIE_NAME`/`COOKIE_PATH` констант; флаги из конфига.
- Modify: `jwt.strategy.ts`, `refresh-token.decorator.ts` — имена кук из констант (не литералы).
- Modify: `src/modules/maintenance/maintenance.service.ts` — cron/timezone/staleDays из конфига, регистрация через `SchedulerRegistry.onModuleInit`.
- Modify: `tokens.service.ts` (TTL из конфига), `workspaces.service.ts` (TTL инвайтов из конфига), `disposable-email.validator.ts` (MX-флаги из конфига — см. интерфейсы ниже).
- Delete: `src/config/configuration.ts` (после sweep-шага Task 1).
- Modify: `.env.template` — полный rewrite под новые имена; локальный `.env` — убрать stale `JWT_SECRET`, если есть.
- Tests: `src/config/app.config.spec.ts` (new), `test/throttle.e2e-spec.ts` (new, 429), дополнить `maintenance.service.spec.ts` (registry).

## Interfaces

```ts
// app.config.ts
interface ThrottleProfileCfg { limit: number; ttlMs: number; }
type ThrottleProfileName = 'authStrict' | 'recovery' | 'invite'; // 'global' — только для guard, не для декоратора
interface AppConfig {
  app: { port: number; isProduction: boolean };
  cors: { origins: string[] };
  throttle: { global: ThrottleProfileCfg; authStrict: ThrottleProfileCfg; recovery: ThrottleProfileCfg; invite: ThrottleProfileCfg };
  jwt: AuthConfig; // существующий интерфейс из auth.config.ts, строится тем же кодом один раз
  cookies: { accessName: string; refreshName: string; path: string; sameSite: 'lax' | 'strict' | 'none'; secure: boolean; httpOnly: true };
  email: { verifyMx: boolean; mxTimeoutMs: number; extraBlockedDomains: string[] };
  invitations: { ttlSec: number };
  tokens: { confirmTtlSec: number; recoveryTtlSec: number };
  maintenance: { cron: string; timeZone: string; staleSessionDays: number };
}
loadAppConfig(env?: NodeJS.ProcessEnv): AppConfig; // env опционален ТОЛЬКО здесь (default process.env) — единственное место чтения
// toAuthConfig НЕ нужен отдельной функцией: поле jwt и есть AuthConfig, AUTH_CONFIG = app.jwt напрямую.
```

Дефолты (байт-в-байт текущие): port 3000; cors dev `['http://localhost:5173','http://localhost:1420']`, prod — CORS_ORIGINS обязателен; throttle `120/60000, 10/60000, 5/60000, 30/60000`; jwt дефолты как сейчас (600/604800/bios/bios-api/5); cookies имена `access_token/refresh_token`, path `/`, sameSite `lax`, secure=isProduction, httpOnly true; email verifyMx true, mxTimeout 3000, extra []; invitations 604800; tokens 86400/3600; maintenance `0 3 * * *`, `UTC`, 30.

Env-имена: `PORT`, `CORS_ORIGINS`, `THROTTLE_{GLOBAL,AUTH_STRICT,RECOVERY,INVITE}_{LIMIT,TTL_MS}`, все `JWT_*` без изменений, `COOKIE_{ACCESS_NAME,REFRESH_NAME,PATH,SAMESITE,SECURE?}` (SECURE опционален: задан → boolean, иначе isProduction), `EMAIL_VERIFY_MX/EMAIL_MX_TIMEOUT_MS/EMAIL_EXTRA_BLOCKED_DOMAINS`, `INVITATION_TTL_SEC`, `TOKEN_{CONFIRM,RECOVERY}_TTL_SEC`, `MAINTENANCE_{CRON,TIMEZONE,STALE_DAYS}`.

Fail-fast таблица (throw с именем переменной): PORT целый 1–65535; CORS prod без CORS_ORIGINS → throw, каждый origin валидный URL; throttle limit целое ≥1, ttlMs целое ≥1; TTL-секунды целые ≥1 с верхними границами (access ≤86400, refresh ≤2592000, invitation ≤2592000, confirm ≤604800, recovery ≤86400); mxTimeout целое ≥1; extra-домены нормализовать lower+trim, пустые выкинуть; cron валидировать `new CronJob(cron, noop)` из пакета `cron`, timezone через `Intl.supportedValuesOf('timeZone')`; sameSite ∈ {lax,strict,none}, `none`+!secure → throw; JWT-проверки без изменений (ключи/iss/aud/tolerance).

Throttle-механика (v6, сверено с исходниками гарда): `forRootAsync({ useFactory: (cfg: AppConfig, reflector: Reflector) => ({ throttlers: [
{ name:'global', ...cfg.throttle.global },
{ name:'authStrict', ...cfg.throttle.authStrict, skipIf: (ctx) => profileOf(ctx) !== 'authStrict' },
{ name:'recovery', ... }, { name:'invite', ... }] }), inject: [APP_CONFIG, Reflector] })`,
где `profileOf` читает `reflector.getAllAndOverride(THROTTLE_PROFILE_KEY, [handler, class])`. Семантика: additional, effective = min(global, profile). Хранилище in-memory как сейчас (мульти-инстанс → Redis, зафиксировано в коде комментарием).

Cron-механика: убрать `@Cron`, в `onModuleInit` — `this.scheduler.addCronJob('purgeExpired', new CronJob(cron, () => void this.purgeExpired(), null, true, timeZone))`; `CronJob` импортировать из `'cron'` (транзитивная зависимость `@nestjs/schedule`, зафиксировать комментарием). Мульти-инстанс: purge идемпотентен (deleteMany), benign.

## Tasks

### Task 1: Лоадер + типы + тесты + sweep legacy

**Files:** Create `src/config/app.config.ts`; Test `src/config/app.config.spec.ts`.

- [ ] **Step 1: Sweep legacy перед удалением**

Run: `grep -rn "JWT_SECRET\|from.*config/configuration" --include="*.ts" src test app/backend/src 2>/dev/null; grep -rn "JWT_SECRET" .env.template docker-compose.yml Dockerfile app/backend/Dockerfile 2>/dev/null; ls .github/workflows systemd 2>/dev/null || true` в корне. Expected: совпадения только `.env.template` (`JWT_SECRET=`), локальный `.env` (gitignored), сам `configuration.ts`. Всё остальное отсутствует → удаление безопасно.

- [ ] **Step 2: Написать падающие тесты `app.config.spec.ts`**

```ts
// дефолты (NODE_ENV=test): port 3000, throttle 120/10/5/30 при ttlMs 60000, accessTtl 600, refreshTtl 604800,
// iss 'bios', aud 'bios-api', cookies access_token/refresh_token + lax + secure=false, verifyMx true,
// mxTimeout 3000, invitations 604800, tokens 86400/3600, cron '0 3 * * *', tz 'UTC', stale 30
// JWT для тестов: сгенерировать пару RSA в beforeAll, передать через JWT_PRIVATE_KEY/JWT_PUBLIC_KEY
// invalid: PORT=abc/0/99999, THROTTLE_GLOBAL_LIMIT=0, TTL=0/-5/1.5, cron 'nonsense', tz 'Mars/Olympus',
//   sameSite=banana, sameSite=none без secure, prod без CORS_ORIGINS -> throw
// prod с CORS_ORIGINS + ключами -> ok, secure=true, ephemeral=false
// app.jwt побайтово равен прямому loadAuthConfig(тот же env) по полям fingerprint/accessTtlSec/refreshTtlSec/issuer/audience
```

- [ ] **Step 3: Запустить, убедиться что падает**

Run: `npx jest src/config/app.config.spec.ts` в `app/backend`. Expected: FAIL (модуля нет).

- [ ] **Step 4: Реализовать `app.config.ts`** (типы, валидаторы `positiveInt/minSec/parseList/cron`, `loadAppConfig`, `APP_CONFIG = Symbol`).

- [ ] **Step 5: Зелёные тесты + prettier/eslint**

Run: `npx jest src/config/`, `npx prettier --check`, `npx eslint src/config/`. Expected: PASS/чисто.

- [ ] **Step 6: Коммит**

```bash
git add app/backend/src/config/app.config.ts app/backend/src/config/app.config.spec.ts
git commit -m "feat(backend): centralized AppConfig loader with fail-fast validation"
```

### Task 2: DI-wiring, удаление legacy

**Files:** Create `app-config.module.ts`; Modify `auth.config.ts` (обязательный env, без дефолта), `auth.module.ts`, `main.ts`; Delete `configuration.ts`.

- [ ] **Step 1: Модуль-синглтон и фабрика AUTH_CONFIG**

`app-config.module.ts`: `const appConfig = loadAppConfig();` на уровне модуля + `@Global() @Module({ providers: [{ provide: APP_CONFIG, useValue: appConfig }], exports: [APP_CONFIG] })`, экспорт значения `appConfig` для `main.ts`. `auth.module.ts`: `{ provide: AUTH_CONFIG, useFactory: (app: AppConfig) => app.jwt, inject: [APP_CONFIG] }`. `auth.config.ts`: сигнатура `loadAuthConfig(env: NodeJS.ProcessEnv)` (дефолт убрать); существующие спеки уже передают env явно — проверить прогоном. `main.ts`: `import { appConfig } from './config/app-config.module'` → `parsePort`/`parseOrigins` удалить, использовать `appConfig.app.port`, `appConfig.cors.origins`. Удалить `configuration.ts`.

- [ ] **Step 2: Верификация**

Run: `npx jest` (все 61+), `npm run build`, `npx eslint src/config/ src/main.ts src/modules/auth/auth.module.ts src/modules/auth/auth.config.ts`, `grep -rn "process\.env" src --include="*.ts" | grep -v spec` → только `app.config.ts`. Expected: зелёное, grep — одна строка файла.

- [ ] **Step 3: Коммит**

```bash
git add app/backend/src/config/ app/backend/src/main.ts app/backend/src/modules/auth/auth.module.ts app/backend/src/modules/auth/auth.config.ts
git commit -m "refactor(backend): wire AppConfig through DI, drop legacy configuration"
```

### Task 3: Throttle из конфига

**Files:** Create `common/throttle/throttle-profile.decorator.ts`; Modify `app.module.ts`, контроллеры auth/users/workspaces (замена декораторов).

- [ ] **Step 1: Декоратор + forRootAsync + замены**

`throttle-profile.decorator.ts`: `export const THROTTLE_PROFILE_KEY = 'throttle-profile'; export const ThrottleProfile = (p: 'authStrict'|'recovery'|'invite') => SetMetadata(...)`. `app.module.ts`: `ThrottlerModule.forRootAsync({ useFactory: (cfg: AppConfig, reflector: Reflector) => ({ throttlers: [global + 3 именованных со skipIf через reflector.getAllAndOverride] }), inject: [APP_CONFIG, Reflector] })`. Контроллеры: `AUTH_THROTTLE` и инлайн-`@Throttle` → `@ThrottleProfile(...)`. Импорты `@nestjs/throttler` из контроллеров убрать.

- [ ] **Step 2: Unit-тест фабрики + e2e на 429**

Unit (в `app.module.spec.ts`? нет — отдельный `src/common/throttle/throttle-profiles.spec.ts`): вызвать фабрику с тестовым конфигом, assert 4 throttler с точными limit/ttlMs, `skipIf` true/false на фейковых контекстах с/без метаданных. e2e `test/throttle.e2e-spec.ts`: поднять приложение (`Test.createTestingModule({imports:[AppModule]})`, `DATABASE_URL` на `bios_test`), 11× `POST /auth/login` с невалидным телом → первые 10 не-429, 11-й 429. (Невалидное тело даёт 400, но счётчик throttler тикает — то, что проверяем.)

- [ ] **Step 3: Верификация**

Run: `npx jest src/common/throttle/`, `npx jest --config ./test/jest-e2e.json test/throttle.e2e-spec.ts`, полный `npx jest`, build, lint новых файлов. Expected: зелёное.

- [ ] **Step 4: Коммит**

```bash
git add app/backend/src/common/throttle/ app/backend/src/app.module.ts app/backend/src/modules/auth/auth.controller.ts app/backend/src/modules/users/users.controller.ts app/backend/src/modules/workspaces/workspaces.controller.ts app/backend/test/throttle.e2e-spec.ts
git commit -m "feat(backend): drive throttler profiles from AppConfig"
```

### Task 4: Cookies из конфига

**Files:** Modify `auth-cookies.ts`, `jwt.strategy.ts`, `refresh-token.decorator.ts`.

- [ ] **Step 1: Константы имён + флаги из конфига**

`auth-cookies.ts`: `export const ACCESS_COOKIE_NAME='access_token'`, `REFRESH_COOKIE_NAME`, `COOKIE_PATH='/'`; `buildCookieOptions` берёт `{ cookieSecure, sameSite, path }` из `AppConfig['cookies']` (имена/path — константы, не env: деплой их не меняет). strategy/decorator/controllers — заменить литералы на константы.

- [ ] **Step 2: Верификация**

Run: `npx jest src/modules/auth/`, build, eslint. Expected: зелёное (поведение кук не меняется — покрыто существующими тестами на флаги через `buildCookieOptions`? добавить 2 assert'а в `jwt-token.service.spec.ts`? нет — добавить маленький `auth-cookies.spec.ts`: set/clear выставляют ожидаемые имена+флаги из конфига).

- [ ] **Step 3: Коммит**

```bash
git add app/backend/src/modules/auth/auth-cookies.ts app/backend/src/modules/auth/auth-cookies.spec.ts app/backend/src/modules/auth/guards/jwt.strategy.ts app/backend/src/modules/auth/decorators/refresh-token.decorator.ts
git commit -m "refactor(backend): single-source cookie names and flags"
```

### Task 5: Email/invitations/tokens/maintenance из конфига

**Files:** Modify `disposable-email.validator.ts`, `workspaces.service.ts`, `tokens.service.ts`, `maintenance.service.ts` (+ его spec на registry).

- [ ] **Step 1: Инжект APP_CONFIG вместо чтения env/констант**

Валидатор — проблема: class-validator constraint создаётся фреймворком, DI туда не доходит. Решение: constraint читает модуль-синглтон `appConfig` (импорт значения из `app-config.module.ts`, не `process.env`): `extraBlockedDomains = appConfig.email.extraBlockedDomains` и т.д. MX-флаг/таймаут — оттуда же. `TokensService`: конструктор `+ @Inject(APP_CONFIG)`, TTL из `app.tokens`. `WorkspacesService`: TTL инвайтов из `app.invitations` (конструктор + inject; spec-файлы создают сервис вручную — обновить вызовы `new WorkspacesService(prisma)` → добавить тестовый конфиг-объект). `MaintenanceService`: конструктор `+ SchedulerRegistry + APP_CONFIG`; `onModuleInit` регистрирует `CronJob(cron, cb, null, true, timeZone)`; spec: реальный `SchedulerRegistry`, assert задача `purgeExpired` существует (через `getCronJobs()`), вызвать `purgeExpired()` напрямую как сейчас.

- [ ] **Step 2: Верификация**

Run: полный `npx jest`, build, eslint. Expected: зелёное. Вручную проверить: `EMAIL_EXTRA_BLOCKED_DOMAINS` из конфига реально блочит (покрыто существующим тестом через env — теперь через синглтон: убедиться, что spec мокает/перезагружает модуль? Валидатор читает синглтон, загруженный при импорте с process.env тестового раннера! Существующие тесты меняют `process.env.EMAIL_*` в рантайме — СЛОМАЮТСЯ. Решение: в spec'ах после смены env делать `jest.resetModules()` + `require` заново? ts-jest + ESM-импорты — `require` невозможен. Альтернатива, зафиксированная здесь: валидатор читает не синглтон, а **передаваемый env через `isMxCheckEnabled()`-стиль функций с дефолтом из синглтона**: т.е. constraint вызывает `resolveEmailPolicy()` — функцию, которая при каждом вызове читает `loadAppConfig`-кэш? Перезагрузка конфига при каждой валидации — дорого (121k Set строится один раз — вынести Set в модуль, конфиг-значения читать свежими). Точное решение: `DISPOSABLE_SET` строится один раз на импорт; `extraBlockedDomains/verifyMx/mxTimeout` читаются из `getAppConfig()` — ленивого синглтона с `reloadAppConfigForTests()` экспортом для спек. Spec'ы вызывают reload после смены env. Зафиксировать так; детали — на усмотрение исполнителя в этих границах.)

- [ ] **Step 3: Коммит**

```bash
git add app/backend/src/common/validators/ app/backend/src/modules/tokens/ app/backend/src/modules/workspaces/workspaces.service.ts app/backend/src/modules/maintenance/
git commit -m "feat(backend): source email, invitation, token and maintenance settings from AppConfig"
```

### Task 6: Env-доки и финальная верификация

**Files:** Modify `.env.template`, локальный `.env` (только удаление stale-строк).

- [ ] **Step 1: Rewrite `.env.template`** — все имена из Interfaces выше с дефолтами и комментариями (prod-обязательные пометить REQUIRED IN PRODUCTION: `CORS_ORIGINS`, ключи JWT).

- [ ] **Step 2: Финальный прогон**

Run: `npx jest`, `npm run build`, `npx prettier --check "src/**/*.ts" "test/**/*.ts"`, `npx eslint src/`, grep `process.env` (шаг Task 2), живой smoke (register/login/refresh через dist, проверка изменённого TTL? нет — smoke как раньше), e2e throttle. Expected: всё зелёное.

- [ ] **Step 3: Коммит**

```bash
git add .env.template app/backend/test/throttle.e2e-spec.ts
git commit -m "chore: document centralized configuration env vars"
```

## Self-Review

1. **Spec coverage:** все секции ревью (single source, ttlMs, throttle-семантика, cron через registry + timezone, cookie-консистентность, fail-fast таблица, sweep, миграционные тесты) имеют задачи 1–6.
2. **Step scan:** шаги содержат точные команды/ожидания; тела функций нет, кроме мест где сигнатура+тест не определяют выбор (интерактивная регистрация cron — выбор зафиксирован).
3. **Type consistency:** `ThrottleProfileCfg`, имена профилей, `AppConfig` — едины во всех задачах; `AUTH_CONFIG = app.jwt` без дублирования типов.
4. **Review Focus:** 5 пунктов, каждый с тестом в своей задаче.
5. **Proportion:** план фиксирует решения и границы, а не транскрипт кода.
