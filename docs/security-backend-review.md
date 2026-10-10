# Security Review — Backend (NestJS + Express + Prisma/PostgreSQL)

> Метод: скилл `security-best-practices`, референс `javascript-express-web-server-security.md`, три параллельных агента + ручная верификация ключевых находок. Стек: TypeScript, NestJS 11 (`@nestjs/platform-express`), Prisma 6, PostgreSQL 18, RS256 JWT + ротация, AES-256-GCM секретов.
> Дата: 2026-10-10. TLS out of scope (терминация вне приложения).

## Executive summary

Критических (эксплуатируемых сейчас) находок нет. Аутентификация, криптография, валидация входов, SSH-поверхность и секреты — в хорошем состоянии. Реальные проблемы: High — 1 (зависимости: proxy-addr/multer через Express-цепочку), Medium — 3 (trust proxy + throttling за LB, токены в URL попадают в логи, неатомарное списание recovery), Low/Info — остальное. Плюс честный список «verify-at-runtime».

## High

**S1. Уязвимые транзитивные зависимости (EXPRESS-DEPS-001). — FIXED (`210bccf`).** `npm audit fix` без `--force`: critical proxy-addr и high multer ушли (8→4). Остаток только под `--force`: deepmerge-ts high (dev-цепочка `prisma`, не prod) и uuid moderate (`buf`-API не используем, v14 ломает CJS — оставлено осознанно). Проверено: jest + build чисто.

## Medium

**S2. Нет `trust proxy` — throttling слеп за балансировщиком (EXPRESS-PROXY-001). — FIXED (`df289c9`).** `TRUST_PROXY` в конфиге (`app.config.ts`, `main.ts`): `false` (дефолт, слушаем напрямую), число хопов или IP/подсеть; голое `true` запрещено ошибкой. Тесты на парсинг + прод-валидацию.

**S3. Recovery/confirm-токены в URL оседают в логах (EXPRESS-ERROR-001). — FIXED (`967c6c7`).** Токены переехали в body (`PATCH users/confirm`, `PATCH users/recovery`), `GET recovery/:id` удалён, DTO `find-*.dto` удалены. Заодно S6 на этих роутах: `ThrottleProfile('recovery')` + `authStrict` на change-password.

**S4. Неатомарное списание recovery/confirm (EXPRESS-SESS-002). — FIXED (`1039fd9`).** `Promise.all` заменён на `$transaction` с delete-first (0 строк → 404). Добавлен тест параллельного двойного recovery (ровно один выигрывает).

## Low / Info

**S5. Access живёт после logout до `exp` (EXPRESS-AUTH-001, judgement). — ACCEPTED без кода.** Дефолт 600с + верхняя граница 86400 в валидации конфига; окно осознанно, denylist — при появлении требований.

**S6. Нет per-route throttle на recovery/confirm/change-password (EXPRESS-INPUT-002, info).** Только global 120/мин. Брутфорс uuidv7 (122 бит) нереален — defence-in-depth: добавить `ThrottleProfile`.

**S7. Dockerfile: root + devDeps, нет HEALTHCHECK (info). — FIXED (`37f7fee`).** Контейнер бежит как `node`, HEALTHCHECK на `/api/v1/health` (статус `healthy` проверен живьём). devDeps оставлены сознательно: `prisma` CLI нужен в рантайме для `migrate deploy`.

**S8. Body-limit не задан явно (EXPRESS-BODY-001, info). — ACCEPTED без кода.** Дефолт Nest/Express ~100kb адекватен: крупнейшие легитимные тела — PEM-ключи (≤16kb); multipart отсутствует. Вернуться при появлении загрузок файлов.

## Проверено и хорошо (не чинить)

RS256-allowlist + iss/aud/exp + `token_type` (`jwt-token.service.ts`, `jwt.strategy.ts`); ротация atomic claim + reuse→отзыв семьи вне транзакции; argon2; RSA≥2048 + проверка пары; host-key pinning до auth; network-policy (link-local incl. 169.254.169.254, DNS-all, коннект на проверенный IP — TOCTOU закрыт); Prisma без raw SQL; shell только через `shq()`; секреты вне git (`*_PATH/*_FILE`, `/run/secrets`, `.gitignore`); helmet+CSP/nosniff/SAMEORIGIN, `X-Powered-By` скрыт; CORS-allowlist + prod-fail-fast; куки HttpOnly/Secure(prod)/Lax; 500-е generic + стек только в лог; `--inspect` только в dev-скрипте; редиректов/`sendFile`/static/uploads нет; `trustHostKey`-regex fail-closed.

## Verify-at-runtime (не видно из кода)

R1. `X-Powered-By` реально скрыт (проверялось ранее — да). R2. За LB включить узкий `trust proxy` (см. S2). R3. `SSH_ALLOWED_PORTS=22`, `SSH_ALLOW_LOOPBACK=false` в проде. R4. Локальные `./secrets/*`, `.env` (600) не коммитить; ротация `SERVER_CRYPTO_KEY` через `OLD_KEYS`. R5. Шифрование бэкапов Postgres + отдельный бэкап ключа (потеря = все credentials мертвы).
