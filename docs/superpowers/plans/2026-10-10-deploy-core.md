# Deploy core (часть 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать MVP возможность создать проект (публичный git-репозиторий) и конфигурацию деплоя, запустить ручной деплой на подключённый сервер и увидеть его статус, журнал и длительность — без ручного SSH.

**Architecture:** Три новые Prisma-модели (`Project` → `DeployConfig` → `Deployment`) живут в существующих модулях-заглушках `projects` и `deployments`. Деплой — это асинхронная задача на панели: `POST /deployments` атомарно создаёт строку `QUEUED` и отвечает `202`, исполнитель в том же процессе подбирает очередь и исполняет план из четырёх SSH-шагов (preflight → source → build → run) через уже проверенный шов `SshRunner.exec` той же политикой адресов и тем же пином host key, что и части 3/4. Каждый шаг — отдельный `exec`, поэтому журнал растёт по шагам, а не дожидается конца сборки, и память панели ограничена хвостом, отрезанным на хосте.

**Tech Stack:** NestJS 11, Prisma 6.19.3 + PostgreSQL, class-validator/class-transformer, `node-ssh`/`ssh2` (уже в зависимостях), jest + ts-jest, `@nestjs/throttler`, `@nestjs/schedule`.

**Spec:** `docs/mvp-scope.md` — раздел «### 5. Deploy минимум (6–7)» и Definition of Done; пути эндпоинтов — `API.md:27-31` (projects), `API.md:107-122` (deployments, deploy-configs). Метрика спринта: `git push → deploy → logs`, первый деплой < 10 мин.

**Статус исполнения (2026-10-10, `superpowers:executing-plans`).** Tasks 0–8 выполнены и проверены: 37 unit-сюит / 382 теста PASS, `test/deploy-core.e2e-spec.ts` — 10/10 PASS, `npm run build` и eslint чисты, миграция применена на 10 тестовых БД, живой smoke прогнан и убран (раздел «Живой smoke» ниже). Шаги «Коммит» оставлены незакрытыми намеренно: в этом же дереве лежит незакоммиченная работа второго редактора, и `prisma/schema.prisma` с `src/config/app.config.ts` он тоже правит — правило Task 0 запрещает уводить его правки в мой коммит. Отступления от плана, найденные прогоном, собраны в пункте 5 раздела «Само-ревью плана».

---

## Граница объёма (решение владельца, 2026-10-10)

Владелец сформулировал deploy-подсистему шире, чем §5 mvp-scope: **4 метода** (Git Pull, Docker Compose, Shell Script, Custom Commands) и **7 возможностей** (ручной и автоматический деплой, rollback, история деплоев, статусы, журнал выполнения, длительность операций). Это несколько подсистем, и по `writing-plans` каждая требует своего плана. Здесь — **срез 1 (ядро)**, остальные четыре перечислены в конце файла как roadmap; каждый из них — самостоятельный план, который оставляет продукт рабочим.

| Срез | Что приносит | Статус |
|---|---|---|
| 1. Deploy core | Модель, CRUD проектов и конфигураций, ручной деплой методом `GIT_PULL`, статусы, журнал по шагам, длительность, история | **этот план** |
| 2. Методы деплоя | `COMPOSE`, `SHELL_SCRIPT`, `CUSTOM_COMMANDS` как стратегии исполнителя | roadmap |
| 3. Rollback | Повторный запуск сохранённого `imageTag` + `POST .../deployments/:id/rollback` | roadmap (подготовка — в срезе 1: тег хранится с первого деплоя) |
| 4. Автодеплой | Webhook/poll репозитория + `schedules` из `API.md:114-116` | roadmap |
| 5. История и метрики | Фильтры по конфигу, агрегаты длительности, `GET .../deploy-configs/:id/history` | roadmap (данные уже пишутся в срезе 1) |

## Global Constraints

- DoD из `docs/mvp-scope.md`: «Endpoint + Prisma-модель + guard/workspace-scoping + e2e через куки `access_token`, без заглушек `→null/[]`».
- Метрика: «`git push → deploy → logs`; первый деплой < 10 мин» (таблица спринтов, §4 Деплой).
- **Только публичные HTTPS-репозитории** (решение владельца): в схеме нет и не появляется поля секрета репозитория; URL с credentials (`https://user:token@…`) отклоняется на границе DTO.
- **Исполнитель — in-process на панели + reconcile при старте** (решение владельца): осиротевшие `QUEUED`/`RUNNING` при старте процесса помечаются `INTERRUPTED`, автоматического перезапуска нет.
- Деплой — операция OWNER'а (`OWNER_ONLY_ROLES`), чтение истории/логов — любого участника (`MEMBER_ROLES`). Правила ролей взяты из части 4 (`docker.service.ts:105-134`, restart = OWNER).
- Любой пользовательский символ, попадающий в shell, проходит через `shq()` (`src/modules/servers/agent/shell-quote.ts:2`); имена проверяются whitelist-regex'ами на границе (`src/common/validators/display-name.validator.ts:13`) — правило зафиксировано в security-review: «shell только через `shq()`».
- Ошибки зависимостей — `FailedDependencyException` (424), дедлайн — `UpstreamTimeoutException` (504), отсутствие строки/чужой воркспейс — 404, роль не та — 403. `500` остаётся только внутренним дефектам панели.
- Никаких новых npm-зависимостей: `git` и `docker` исполняются на удалённом хосте, панель их не вызывает локально.
- Пустые заглушки `src/modules/servers/compose/*` и `src/modules/servers/git/*` (`ComposeService`/`GitService` — 3 строки каждая) в этом срезе **не реализуются и не удаляются**: это области `API.md:70-77` (compose-проекты) и `API.md:100-106` (git runs, артефакты), которых нет в §5 mvp-scope. Молча менять чужой незанятый контракт план не вправе.
- Тестовые БД: своя база на спека, как в частях 3/4 (`bios_test_servers`, `bios_test_docker`) — здесь `bios_test_deploy` (Task 3 и e2e), `bios_test_deploy_configs` (Task 4), `bios_test_deploy_runner` (Task 6), `bios_test_deployments` (Task 7). Причина не в стиле: jest гоняет файлы в параллельных воркерах, и два спека на одной базе ломают друг друга через `afterEach → deleteMany({})` (замерено на Task 4: 4 красных теста из 321, пока базы не разъехались).
- `dev` — рабочая ветвь; `main` не трогаем, ничего не пушим.

---

## Что уже измерено (не предположение, а прогон 2026-10-10)

Эти числа и поведения план кладёт в основу тестов; при расхождении — править план, а не тест под текущий код.

1. **`git` в smoke-образе отсутствует.** `docker run --rm bios-sshd-p4:latest sh -c 'command -v git'` → `git=ABSENT`, при этом `docker=/usr/bin/docker`. Значит preflight обязан различать «git нет» и «docker нет» отдельными кодами, а живой smoke ставит git в образ (`apk add --no-cache git`).
2. **`docker rm -f <несуществующий>` завершается кодом 0.** Замер: `docker rm -f bios-nonexistent; echo $?` → `0`, текст `Error response from daemon: No such container` уходит в stderr. Шаг `run` можно делать идемпотентным без `|| true`, но `|| true` оставляем: это защита от расхождений версий CLI, а не от замеренного поведения.
3. **`docker build` работает через смонтированный сокет из того же образа.** Замер: `docker build -q -t bios-p5-probe /tmp/ctx` → `exit=0`, в stdout sha256-идентификатор образа. То есть билд на реальном хосте (где сокет локальный) тем более возможен.
4. **Сетевой доступ с хоста есть.** Замер: внутри контейнера `git ls-remote https://github.com/apocas/dockerode HEAD` → `exit=0` и sha. Клонирование публичного репо реально.
5. **Цикл clone → fetch/reset идемпотентен и быстрый.** Замер (`octocat/Hello-World`): `git clone --depth 1 --branch master <url> <dir>` → `exit=0, sec=1, sha=7fd1a60`; повтор `git -C <dir> fetch --depth 1 origin master && git -C <dir> reset --hard origin/master` → `exit=0, sec=2`, тот же sha. `--depth 1` обязателен: полный клон большого репозитория не влезет в 10-минутную метрику.
6. **Отсутствующая ветка отличается от сетевого отказа.** Замер: `git clone --branch main` несуществующей ветки → `exit=128`, stderr `! Remote branch main not found in upstream origin`; при этом `git ls-remote --heads <url> nosuchbranch` → `exit=0` и **0 строк вывода**. Значит шаг `source` сначала спрашивает ref через `ls-remote` (дёшево, различимо), и только потом клонирует: `REF_NOT_FOUND` становится отдельным кодом, а не `SOURCE_FAILED`.
7. **`node-ssh.execCommand` буферизует ВЕСЬ вывод в память панели.** `node_modules/node-ssh/lib/cjs/index.js:282-303` — чанки складываются в `output.stdout[]`, `:327` — `join('')`; лимита нет, и по умолчанию stdout/stderr ещё и `.trim()`-ятся (`:328-331`, `noTrim` не выставлен). Вывод `docker build` размером в сотни МБ лег бы в RAM панели. Отсюда обязательное правило шага: полный лог пишется в файл на хосте, в stdout уходит только хвост в `DEPLOY_LOG_TAIL_BYTES` байт, а код возврата сохраняется явно (`rc=$?`).
8. **`SshRunner.exec` открывает НОВОЕ соединение на каждый вызов** (`node-ssh.runner.ts:65 new NodeSSH()`, `:92 ssh.dispose()`), в отличие от docker-транспорта части 4, где одно соединение держит все вызовы запроса. Следствие для деплоя: 4 шага = 4 KEX ≈ 4×~50 мс (замер части 4) на деплой. Для фоновой задачи это несущественно и осознанно; менять шов ради одного соединения на деплой план не вправе.
9. **`FakeSshRunner.respond()` расходуется один раз и в порядке регистрации** (`fake-ssh.runner.ts:48-58, 87-96`, комментарий на `:16-20`) — ровно то, что нужно многошаговому плану: четыре `respond()` на четыре шага.
10. **В `node-ssh@13.2.1` нет стримингового exec.** Замер: `grep -o "exec[A-Za-z]*" node_modules/node-ssh/lib/cjs/index.js | sort -u` → `exec`, `execCommand`, `execOptions`; `NodeSSH.prototype.execCommandStream` → `undefined`. То есть RAM панели во время шага ограничить этим API нельзя — только размером выводимых данных на самой машине (Known gaps №7).
11. **POSIX-конвейер отдаёт статус последней команды, а `new URL` бросает на порте >65535.** Замеры: `sh -c 'ls /no-such-dir 2>/dev/null | grep -q .; echo $?'` → `1` и `sh -c 'printf "" | grep -q .; echo $?'` → `1` (оба случая неотличимы — отсюда ревью №2); `node -e "new URL('https://github.com:99999/a/b')"` → `TypeError` (отсюда ревью №5: 500 вместо 400).
12. **Заглушки уже смонтированы.** `src/modules/projects/projects.service.ts` — 4 строки (`Injectable` без методов), `projects.controller.ts` — 7 строк (пустой `@Controller('workspaces/:workspaceId/projects')`), `src/modules/deployments/deployments.service.ts` — 4 строки, `deployments.controller.ts` — 7 строк с `@Controller()` без префикса. `ProjectsModule` и `DeploymentsModule` уже в `app.module.ts:24,28`. В схеме Prisma нет `Project`, `DeployConfig`, `Deployment`, и у `Workspace` (`prisma/schema.prisma:70-77`) нет `projects`.
13. **Baseline:** `npx jest` → 27 suite / 271 тест PASS; `dev` = `dab1b45`, часть 4 (`ed23cb1..d3b5fcf`) — предки HEAD.
14. **Песочница (замерено при исполнении Task 5):** на этой машине `/usr/bin/git`
    существует, поэтому тест «git отсутствует» с `PATH=<стабы>:/usr/bin:/bin`
    проходит ложно-зелёно — нужен PATH только из стабовой папки, а в неё надо
    линковать `mkdir`/`cat`/`mv`/`tail`, иначе обёртка теряет их и даёт 127
    вместо 50. Второй замер: стаба `git clone` обязана оставить `src/.git`
    и `src/Dockerfile`, иначе шаг `build` падает на `DOCKERFILE_MISSING` (55)
    вместо проверяемого `BUILD_FAILED` (53). Третий: обёртка сама печатает
    `mkdir -p '<logDir>'`, поэтому ассерт «в команде нет `-p `» для пустых ports
    проверяет не флаг docker, а `mkdir` — проверять надо строку `docker run`.
15. **Харнесс (замерено при исполнении Task 4):** два спека на одной тестовой БД
    в параллельных jest-воркерах ломают друг друга глобальным
    `afterEach → deleteMany({})`: 4 красных теста из 321. Отсюда — своя база на
    каждый спекафайл (`bios_test_deploy_configs`, `bios_test_deploy_runner`,
    `bios_test_deployments`), как в частях 3/4.
16. **Живой дым (Task 8):** дельта `Accepted password` в логе sshd на один деплой
    = ровно 4 → «новое соединение на каждый `exec`» подтверждено не только юнитом.
    Холодный деплой whalesay — 9.1 с, тёплый — 2.2 с, ответ `POST` — 5 мс.
17. **Живой дым:** `docker build -q` без buildx (legacy builder в alpine-образе)
    печатает ~200 байт на маленький образ, поэтому кэп `DEPLOY_HOST_LOG_BYTES`
    живым примером не наступает — он доказан только песочным тестом с 20 000 строк.
18. **Живой дым:** sshd предлагает три хост-ключа (ECDSA/ED25519/RSA), и сравнение
    запиненного отпечатка должно идти со ВСЕМИ, а не с первым: `ssh-keygen -lf` от
    многоключевого keyscan-вывода даёт несколько строк.

---

## File Structure

```
app/backend/prisma/schema.prisma                       + Project, DeployConfig, Deployment, enum'ы
app/backend/prisma/migrations/<ts>_deploy/             новая миграция

app/backend/src/config/app.config.ts                   + deploy-секция (rootDir, stepTimeoutMs,
                                                        logTailBytes)
app/backend/src/config/app.config.spec.ts              + падающие/зелёные тесты секции
app/backend/src/config/testing/app-config.fixture.ts   + deployOverrides (3-й аргумент)

app/backend/src/modules/projects/
  dto/project-ids.dto.ts                               { workspaceId, projectId }
  dto/create-project.dto.ts                            name, repoUrl (https, без credentials)
  dto/create-deploy-config.dto.ts                      name, method, ref, dockerfile,
                                                       containerName, ports
  project.types.ts                                     ответы + валидация repoUrl/ref/ports
  projects.service.ts                                  CRUD чтения/создания проекта
  projects.service.spec.ts                             repoUrl-валидаторы + CRUD на реальном Prisma
  deploy-configs.service.ts                            CRUD конфигураций (чтение + создание)
  deploy-configs.service.spec.ts                       assert-* + create/list с чужими id
  projects.controller.ts                               маршруты projects + deploy-configs
  projects.module.ts                                   imports: PrismaModule, WorkspacesModule

app/backend/src/modules/deployments/
  dto/create-deployment.dto.ts                         { projectId, configId }
  dto/deployment-ids.dto.ts                            { deploymentId }
  dto/list-deployments-query.dto.ts                    ?projectId &configId &limit
  deploy-script.ts                                     чистые билдеры 4 шагов + парсер маркеров
                                                       + классификатор кодов ошибок
  deploy-script.spec.ts                                юниты билдеров/парсера (без shell)
  deploy-script.sandbox.spec.ts                        исполнение в настоящем /bin/sh со стабами
  deployment.types.ts                                  DeployErrorCode, ответы, конверсия шага
  deploy-runner.service.ts                             исполнитель: claim, шаги, журнал, reconcile
  deploy-runner.service.spec.ts                        реальный Prisma + FakeSshRunner, 20 тестов
  deployments.service.ts                               история, детали, логи, атомарный enqueue
  deployments.service.spec.ts                          то же, исполнитель подменён шпионом
  deployments.controller.ts                            POST/GET .../deployments + GET /deployments/:id[/logs]
  deployments.module.ts                                imports: Prisma, Workspaces, Servers, Projects

app/backend/test/deploy-core.e2e-spec.ts               куки + FakeSshRunner: 10 сценариев
/tmp/… (не в репозитории)                              живой smoke: sshd-образ с git + реальный репозиторий
```

Разделение по ответственности, а не по слоям: `projects/` владеет тем, **что** деплоим (проект и его конфигурация), `deployments/` — тем, **как** и **чем это сопровождается** (план шагов, исполнитель, история). `deploy-script.ts` намеренно чистый модуль без Nest и без I/O — по образцу `agent/agent-script.ts`, который тоже полностью покрыт юнит- и песочным тестами.

### Маршруты этого среза

| # | Метод | Путь (префикс `api/v1`) | Успех | Ошибки |
|---|---|---|---|---|
| 1 | POST | `…/workspaces/:workspaceId/projects` | 201 `ProjectResponse` | 400, 401, 403, 404, 409 |
| 2 | GET | `…/workspaces/:workspaceId/projects` | 200 `ProjectResponse[]` | 401, 404 |
| 3 | GET | `…/workspaces/:workspaceId/projects/:projectId` | 200 `ProjectResponse` | 401, 404 |
| 4 | POST | `…/projects/:projectId/deploy-configs` | 201 `DeployConfigResponse` | 400, 401, 403, 404, 409 |
| 5 | GET | `…/projects/:projectId/deploy-configs` | 200 `DeployConfigResponse[]` | 401, 404 |
| 6 | POST | `…/workspaces/:workspaceId/deployments` | 202 `DeploymentResponse` (`QUEUED`) | 400, 401, 403, 404, 409 |
| 7 | GET | `…/workspaces/:workspaceId/deployments` | 200 `DeploymentResponse[]` (история) | 401, 404 |
| 8 | GET | `…/deployments/:deploymentId` | 200 `DeploymentResponse` | 401, 404 |
| 9 | GET | `…/deployments/:deploymentId/logs` | 200 `DeploymentLogsResponse` | 401, 404 |

Вне этого среза и **не заглушены**: `PATCH/DELETE project`, `PATCH/DELETE deploy-config`, `GET .../deploy-configs/:id`, `schedules`, `rollback`, `history` по конфигу, методы `COMPOSE`/`SHELL_SCRIPT`/`CUSTOM_COMMANDS`. Create-валидатор отвергает чужие методы с текстом, называющим срез 2, — это явный отказ, а не половина исполнителя.

Профили троттлинга: маршруты 1–5 и 7–9 ничего удалённо не вызывают (кроме 6) и остаются на `global`; `POST /deployments` получает `sshOps` (6/мин) — это единственный маршрут, за которым стоит SSH-сессия к чужому хосту. `dockerReads` не переиспользуем: он про docker-API-чтения, и смешивать бюджеты значит портить наблюдаемость.

---

## Task 0: Тестовые БД deploy-среза и границы чужих правок

**Files:** нет (shell, коммита нет).

**Interfaces:**
- Consumes: ничего.
- Produces: базы `bios_test_deploy`, `bios_test_deploy_configs`, `bios_test_deploy_runner`, `bios_test_deployments` со всеми применёнными миграциями; константа `TEST_DB_URL` в новых спеках (по одной на файл).

- [x] **Step 1: Зафиксировать состояние дерева и baseline**

```bash
cd app/backend && git log --oneline -3 && git status --short && npx jest 2>&1 | grep -E '^(Test Suites|Tests)'
```

Expected: HEAD содержит часть 4 (`git merge-base --is-ancestor d3b5fcf HEAD && echo ok` → `ok`), все suite зелёные. На чистом HEAD это было 27 suite / 271 тестов; незакоммиченные спеки второго редактора добавляют свои — ориентир не число, а «красных нет». Если красный есть — сначала разбор, план не начинаем.

**Состояние дерева на 2026-10-10 (замерено, и это не «noise», а условие работы).** В рабочем дереве — незнакомые этому плану правки второго редактора, и два файла из его списка план редактирует в Task 1 и Task 2:

```
 M app/backend/prisma/schema.prisma        ← Task 1
 M app/backend/src/config/app.config.ts    ← Task 2
 M app/backend/src/main.ts, servers.service.ts, workspaces.service.ts,
   users.service.ts, prisma.service.ts, logging.interceptor.ts,
   disposable-email.validator.ts, auth-rotation.spec.ts, maintenance.service.spec.ts
?? app/backend/prisma/migrations/20261010210356_user_canonical_email/,
   app/backend/src/common/email/, logging.interceptor.spec.ts, prisma.service.spec.ts,
   docs/security-backend-review.md
```

Отсюда три правила, которые действуют на все задачи плана:

1. `git add` только по явным путям этой задачи, никогда `-A`/`.`/`-a`; перед каждым `git commit` — `git diff --cached --stat` и `git diff --cached <файл>`, чтобы увидеть, что в индекс не попала чужая правка.
2. Если в файле, который требует Task (например, `schema.prisma`), чужая правка ещё не закоммичена — мой hunk добавляется рядом, но коммит может увести её за собой. Это недопустимо: в таком случае шаг с коммитом останавливается, и состояние файла разбирается с владельцем, а не «коммитится как есть».
3. Номера строк в ссылках этого плана сняты с текущего рабочего дерева, а не с HEAD. Поэтому каждый шаг, который вставляет код «после поля X», ищет якорь по имени (`grep -n "servers     Server\[\]" prisma/schema.prisma`), а не по номеру строки.

- [x] **Step 2: Создать базу среза**

```bash
for db in bios_test_deploy bios_test_deploy_configs bios_test_deploy_runner bios_test_deployments; do
  psql -h localhost -U sabir -d postgres -c "CREATE DATABASE $db;"
done
```

Expected: четыре раза `CREATE DATABASE` (повторно — `ERROR: database already exists`, продолжаем; сверяем по `psql -lqt | grep bios_test_deploy`).

- [x] **Step 3: Применить существующие миграции ко всем тестовым базам**

```bash
cd app/backend && for db in bios bios_test bios_test_maintenance bios_test_workspaces bios_test_servers bios_test_docker bios_test_deploy bios_test_deploy_configs bios_test_deploy_runner bios_test_deployments; do
  DATABASE_URL="postgresql://sabir@localhost:5432/$db?schema=public" \
    npx prisma migrate deploy --schema=prisma/schema.prisma; done
```

Expected: десять раз `All migrations have been successfully applied`. Если какая-то база отсутствует — создать и повторить, не «чинить» список молча.

- [x] **Step 4: Проверить, что в схеме действительно нет deploy-моделей**

```bash
cd app/backend && npx prisma db pull --print 2>/dev/null | grep -c "^model \(Project\|DeployConfig\|Deployment\)"
```

Expected: `0`. Это доказательство, что Task 1 не дублирует существующую модель, а `prisma/dbml`-расхождений нет. (Команда только печатает схему, запись не производит — флаг `--print` обязателен.)

- [x] **Step 5: Записать инварианты, которые план обязан сохранить**

Проверить и зафиксировать в теле будущего коммита (правка не требуется):

```bash
cd app/backend && grep -n "OWNER_ONLY_ROLES" src/modules/servers/servers.service.ts | head -3
grep -n "skipUnless('sshOps')" src/common/throttle/throttle-options.factory.ts
grep -n "noTrim\|output.stdout.push" node_modules/node-ssh/lib/cjs/index.js | head -3
```

Expected: `OWNER_ONLY_ROLES` определён в `servers.service.ts:41` и уже используется для install/restart; `sshOps`-профиль собирается фабрикой; `node-ssh` по-прежнему накапливает stdout в массив (строки ~283-302) — если npm обновит пакет и добавит лимит, пункт 7 «Что уже измерено» надо переформулировать, а не молча принять.

---

## Task 1: Prisma: `Project`, `DeployConfig`, `Deployment`

**Files:**
- Modify: `app/backend/prisma/schema.prisma` (в конец файла + поле `projects` в `model Workspace`, `prisma/schema.prisma:70-77`)
- Create: `app/backend/prisma/migrations/<ts>_deploy/migration.sql` (создаёт `npx prisma migrate dev`)

**Interfaces:**
- Consumes: `Workspace` (`schema.prisma:70`), `User` (`:13`), конвенция `uuid(7)` и `@db.Timestamptz(3)`.
- Produces: модели `Project`, `DeployConfig`, `Deployment`; enum'ы `DeployMethod { GIT_PULL COMPOSE SHELL_SCRIPT CUSTOM_COMMANDS }`, `DeploymentStatus { QUEUED RUNNING SUCCESS FAILED INTERRUPTED }`, `DeployStepName { PREFLIGHT SOURCE BUILD RUN }`; `Workspace.projects`. Дальнейшие задачи обращаются как `this.prisma.project`, `this.prisma.deployConfig`, `this.prisma.deployment`.

- [x] **Step 1: Добавить модели и enum'ы**

В `model Workspace` после `servers Server[]` (`schema.prisma:76`) добавить:

```prisma
  projects      Project[]
```

В `model Server` после `lastCheckedAt DateTime? @db.Timestamptz(3)` (`schema.prisma:139`) добавить:

```prisma
  deployConfigs DeployConfig[]
```

В конец `schema.prisma`:

```prisma
model Project {
  id          String           @id @default(uuid(7))
  workspaceId String
  workspace   Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  name        String
  /// Публичный HTTPS-репозиторий. Секретов тут нет по определению (решение владельца):
  /// credentials в URL отклоняются DTO, приватные репо — не этот срез.
  repoUrl     String
  deployConfigs DeployConfig[]
  deployments   Deployment[]
  createdAt   DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime         @updatedAt @db.Timestamptz(3)

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

/// Метод деплоя. Исполняется только GIT_PULL; остальные значения — контракт
/// будущих срезов, create-DTO их отклоняет, чтобы не было полу-заглушек.
enum DeployMethod {
  GIT_PULL
  COMPOSE
  SHELL_SCRIPT
  CUSTOM_COMMANDS
}

enum DeploymentStatus {
  QUEUED
  RUNNING
  SUCCESS
  FAILED
  INTERRUPTED
}

enum DeployStepName {
  PREFLIGHT
  SOURCE
  BUILD
  RUN
}

model DeployConfig {
  id            String       @id @default(uuid(7))
  projectId     String
  project       Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String
  method        DeployMethod @default(GIT_PULL)
  /// Ветка или тег. Пустое значение = ветка по умолчанию репозитория; в этом срезе
  /// требует явного ref'а, чтобы «деплойнул не то» не зависело от состояния clone.
  ref           String
  /// Относительный путь внутри репозитория; валидируется regex, абсолют и `..` запрещены.
  dockerfile    String       @default("Dockerfile")
  /// Имя контейнера на хосте: один контейнер на конфигурацию, повторный деплой
  /// заменяет его через `docker rm -f` (замер: отсутствующий контейнер = код 0).
  containerName String
  /// Маппинги «host:container[/proto]». Массив строк, а не Json: структура
  /// проверяется DTO, и в БД не записывается то, что не прошло валидацию.
  ports         String[]     @default([])
  /// Хост, на который деплоим. FK + Cascade: удаление сервера (часть 3 умеет только
  /// в P1, но схема должна быть корректной уже сейчас) не оставляет конфигурацию
  /// висящей на несуществующий хост.
  serverId      String
  server        Server       @relation(fields: [serverId], references: [id], onDelete: Cascade)
  deployments   Deployment[]
  createdAt     DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime     @updatedAt @db.Timestamptz(3)

  @@unique([projectId, name])
  /// Имя контейнера уникально в пределах СЕРВЕРА, а не проекта: демон считает
  /// имена глобально для своего сокета, и шаг `run` делает `docker rm -f <имя>`.
  /// Две конфигурации разных проектов на одном хосте с одним именем иначе
  /// удаляют контейнер друг друга (ревью №3).
  @@unique([serverId, containerName])
  @@index([serverId])
}

model Deployment {
  id           String                @id @default(uuid(7))
  projectId    String
  project      Project               @relation(fields: [projectId], references: [id], onDelete: Cascade)
  configId     String
  config       DeployConfig          @relation(fields: [configId], references: [id], onDelete: Cascade)
  /// Кто запустил. Исполнитель перечитывает доступ по этому пользователю:
  /// если участник вышел из воркспейса, задача падает с 403/404, а не деплоит «вслепую».
  triggeredById String
  status       DeploymentStatus      @default(QUEUED)
  step         DeployStepName?
  /// Журнал: конкатенация хвостов шагов (каждый ≤ DEPLOY_LOG_TAIL_BYTES, шага 4),
  /// поэтому размер строки ограничен по построению, а не отдельным лимитом.
  log          String                @default("")
  /// Полное имя образа (`bios-deploy:<id деплоя>`), сохранённое с первого запуска:
  /// срез rollback перезапускает контейнер по уже существующему образу, поэтому
  /// поле нужно в истории, а не только в `docker run` команды.
  imageTag     String?
  commitSha    String?
  containerId  String?
  /// Код из словаря DeployErrorCode (TypeScript), в БД — свободная строка:
  /// список пополняется без DDL, как lastAgentErrorCode в Server (schema.prisma:138).
  errorCode    String?
  exitCode     Int?
  /// NULL, пока задача в очереди: длительность считается от фактического старта.
  startedAt    DateTime?             @db.Timestamptz(3)
  finishedAt   DateTime?             @db.Timestamptz(3)
  durationMs   Int?
  /// Снимок конфигурации на момент запуска: правка конфигурации между деплоями
  /// не должна переписывать историю задним числом.
  snapshot     Json?
  createdAt    DateTime              @default(now()) @db.Timestamptz(3)

  @@index([projectId, createdAt])
  @@index([configId, createdAt])
  @@index([status])
}
```

После `model Server` есть `enum ServerStatus` и т.д.; новые enum'ы размещаются строго после моделей, в которые входят, — как в существующей части файла (`enum ServerAuthType` после `model Server`).

Правило «одна активная задача на конфигурацию» реализовано в `Deployment.activeConfigId` (Step 2), а не проверкой «прочитал-и-записал» в сервисе и не `@@unique([configId, status])`: последний запретил бы два `FAILED` в истории. В `Step 4` ожидаем проверку FK `serverId → Server.id` с `ON DELETE CASCADE` — без неё удаление сервера оставило бы конфигурацию, которая всегда падает на `loadForSsh`.

- [x] **Step 2: Внести `activeConfigId` в `Deployment`**

В модель `Deployment` перед `createdAt` добавить:

```prisma
  /// Ровно одна активная задача на конфигурацию: значение = configId в QUEUED/RUNNING
  /// и NULL после завершения. NULL не конфликтует, поэтому история FAILED/SUCCESS
  /// не ограничена (тот же приём, что @@unique([workspaceId, hostKeyFingerprint])).
  activeConfigId String? @unique
```

- [x] **Step 3: Миграция и синхронизация всех баз**

```bash
cd app/backend && DATABASE_URL="postgresql://sabir@localhost:5432/bios?schema=public" \
  npx prisma migrate dev --name deploy --schema=prisma/schema.prisma
for db in bios_test bios_test_maintenance bios_test_workspaces bios_test_servers bios_test_docker bios_test_deploy bios_test_deploy_configs bios_test_deploy_runner bios_test_deployments; do
  DATABASE_URL="postgresql://sabir@localhost:5432/$db?schema=public" \
    npx prisma migrate deploy --schema=prisma/schema.prisma; done
```

Expected: `prisma/migrations/<ts>_deploy/migration.sql`, девять раз `All migrations have been successfully applied`. `prisma generate` выполняется внутри `migrate dev`; если клиент не перегенировался — `npx prisma generate` вручную и повторить сборку.

- [x] **Step 4: Проверить структуру и сборку**

```bash
cd app/backend && psql -h localhost -U sabir -d bios -c '\d "Deployment"' && psql -h localhost -U sabir -d bios -c '\d "DeployConfig"' && npm run build
```

Expected в `\d "Deployment"`: колонки `"activeConfigId"` (text, nullable) с `Unique: "Deployment_activeConfigId_key"`, индексы `"Deployment_projectId_createdAt_idx"`, `"Deployment_configId_createdAt_idx"`, `"Deployment_status_idx"`, FK `configId → DeployConfig.id` и `projectId → Project.id` с `ON DELETE CASCADE`, `"status"` (`DeploymentStatus`, default `QUEUED`).
Expected в `\d "DeployConfig"`: `"ports"` типа `text[]` с default `{}`, `Unique: "DeployConfig_projectId_name_key"` и `"DeployConfig_serverId_containerName_key"` (последняя — защита от `docker rm -f` чужого контейнера, ревью №3), индекс `"DeployConfig_serverId_idx"`.
`npm run build` — без ошибок; `npx tsc --noEmit -p tsconfig.json` — пусто.

- [x] **Step 5: Проверить, что enum метода не даёт молча писать неисполняемое значение**

```bash
cd app/backend && grep -n "COMPOSE\|SHELL_SCRIPT\|CUSTOM_COMMANDS" prisma/schema.prisma
```

Expected: три значения есть в `enum DeployMethod` и нигде больше в коде (grep по `src` вернёт 0 совпадений до Task 4). План фиксирует: enum — контракт данных, а не обещание исполнителя; границу держит DTO (Task 4 Step 1), и тест на отказ `COMPOSE` обязателен.

- [ ] **Step 6: Коммит**

```bash
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/prisma/schema.prisma app/backend/prisma/migrations/*_deploy
git commit -m "feat(backend): project, deploy config and deployment models

История деплоя хранит снимок конфигурации (snapshot) и imageTag: снимок — источник
значений для исполнителя, правка конфигурации не переписывает прошлое и не меняет
то, что уже поставлено в очередь. Имя контейнера уникально в пределах сервера, а
не проекта: docker считает имена глобальными для демона, и шаг run делает rm -f.
Одна активная задача на конфигурацию держится уникальным activeConfigId (NULL не
конфликтует), а не сырым SQL и не проверкой «прочитал-и-записал» в сервисе.
"
```

---

## Task 2: `AppConfig.deploy` — корень на хосте, дедлайн шага и хвост журнала

**Files:**
- Modify: `app/backend/src/config/app.config.ts` (интерфейс `AppConfig` — `:48-64`, блок `docker` — `:458-470`, `positiveInt` — `:87-108`)
- Modify: `app/backend/src/config/app.config.spec.ts`
- Modify: `app/backend/src/config/testing/app-config.fixture.ts`

**Interfaces:**
- Consumes: `positiveInt(raw, name, {min, max, fallback})` (`app.config.ts:87`), существующая секция `docker` (часть 4).
- Produces: `export interface DeployCfg { rootDir: string; stepTimeoutMs: number; logTailBytes: number; hostLogBytes: number; maxParallel: number }`, `AppConfig['deploy']`, env-имена `DEPLOY_ROOT_DIR`, `DEPLOY_STEP_TIMEOUT_MS`, `DEPLOY_LOG_TAIL_BYTES`, `DEPLOY_HOST_LOG_BYTES`, `DEPLOY_MAX_PARALLEL`; `testAppConfig(sshOverrides?, dockerOverrides?, deployOverrides?)`.

- [x] **Step 1: Падающие тесты секции**

В `src/config/app.config.spec.ts` внутрь `describe('ssh, network policy, crypto keys and sshOps')` (после теста `docker limits: ноль, мусор и выход за диапазон`, добавленного частью 4):

```ts
  test('deploy: дефолты соответствуют плану (корень на хосте, 5 мин на шаг, два слота)', () => {
    expect(loadAppConfig(withKeys()).deploy).toEqual({
      rootDir: '/opt/bios-deploy',
      stepTimeoutMs: 300000,
      logTailBytes: 32768,
      hostLogBytes: 1048576,
      maxParallel: 2,
    });
    expect(
      loadAppConfig(
        withKeys({
          DEPLOY_ROOT_DIR: '/srv/deploy',
          DEPLOY_STEP_TIMEOUT_MS: '60000',
          DEPLOY_LOG_TAIL_BYTES: '4096',
          DEPLOY_HOST_LOG_BYTES: '65536',
          DEPLOY_MAX_PARALLEL: '1',
        }),
      ).deploy,
    ).toEqual({
      rootDir: '/srv/deploy',
      stepTimeoutMs: 60000,
      logTailBytes: 4096,
      hostLogBytes: 65536,
      maxParallel: 1,
    });
  });

  test('deploy: корень обязан быть абсолютным и без shell-метасимволов', () => {
    for (const bad of ['opt/x', '', '/opt/x; rm -rf /', '/opt/$(id)', "/opt/x'y"]) {
      expect(() => loadAppConfig(withKeys({ DEPLOY_ROOT_DIR: bad }))).toThrow(
        /DEPLOY_ROOT_DIR/,
      );
    }
  });

  test('deploy: границы чисел — fail-fast с именем переменной', () => {
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_STEP_TIMEOUT_MS: '0' })),
    ).toThrow(/DEPLOY_STEP_TIMEOUT_MS/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_STEP_TIMEOUT_MS: '900001' })),
    ).toThrow(/DEPLOY_STEP_TIMEOUT_MS/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_LOG_TAIL_BYTES: '512' })),
    ).toThrow(/DEPLOY_LOG_TAIL_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_LOG_TAIL_BYTES: '262145' })),
    ).toThrow(/DEPLOY_LOG_TAIL_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_HOST_LOG_BYTES: '65535' })),
    ).toThrow(/DEPLOY_HOST_LOG_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_HOST_LOG_BYTES: '8388609' })),
    ).toThrow(/DEPLOY_HOST_LOG_BYTES/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_MAX_PARALLEL: '0' })),
    ).toThrow(/DEPLOY_MAX_PARALLEL/);
    expect(() =>
      loadAppConfig(withKeys({ DEPLOY_MAX_PARALLEL: '9' })),
    ).toThrow(/DEPLOY_MAX_PARALLEL/);
  });

  test('deploy: хвост панели не может быть больше кэпа на хосте', () => {
    // иначе «хвост в 32 КБ» вырезается из файла, который урезан до 64 КБ, и
    // контракт двух лимитов разъезжается
    expect(() =>
      loadAppConfig(
        withKeys({ DEPLOY_LOG_TAIL_BYTES: '131072', DEPLOY_HOST_LOG_BYTES: '65536' }),
      ),
    ).toThrow(/DEPLOY_HOST_LOG_BYTES/);
  });
```

Run: `npx jest src/config` → Expected: четыре новых теста FAIL (`Cannot read properties of undefined (reading 'rootDir')` для первого, `/DEPLOY_ROOT_DIR/`, `/DEPLOY_HOST_LOG_BYTES/`, `/DEPLOY_MAX_PARALLEL/` не бросаются для остальных).

- [x] **Step 2: Реализовать секцию**

В `app.config.ts` после `export interface DockerCfg { … }` добавить:

```ts
export interface DeployCfg {
  /** Корень, под которым панель держит clone и логи на ХОСТЕ. Абсолютный путь. */
  rootDir: string;
  /** Дедлайн ОДНОГО шага: сборка образа — минуты, preflight — десятки мс. */
  stepTimeoutMs: number;
  /** Сколько байт журнала шага приезжает в панель (полный лог остаётся на хосте). */
  logTailBytes: number;
  /** Сколько байт вывода шага оставляем на хосте (ревью №4 «остальное»). */
  hostLogBytes: number;
  /** Сколько деплоев исполнитель ведёт одновременно (ревью №11). */
  maxParallel: number;
}
```

Пять полей, и в них нет `keepImages`/политики чистки образов: в этом срезе ничего не удаляет образы, поэтому такая настройка была бы мёртвым конфигом, который читается, но никем не исполняется. Срез 3 (rollback) введёт `DEPLOY_KEEP_IMAGES` вместе с шагом `prune`, который его реально использует.

В `export interface AppConfig` после `docker: DockerCfg;` (`app.config.ts:64`):

```ts
  deploy: DeployCfg;
```

После блока `const docker: DockerCfg = { … };` (`app.config.ts:458-470`):

```ts
  const deploy: DeployCfg = {
    rootDir: parseAbsoluteDir(env.DEPLOY_ROOT_DIR),
    stepTimeoutMs: positiveInt(
      env.DEPLOY_STEP_TIMEOUT_MS,
      'DEPLOY_STEP_TIMEOUT_MS',
      { min: 1000, max: 900000, fallback: 300000 },
    ),
    logTailBytes: positiveInt(
      env.DEPLOY_LOG_TAIL_BYTES,
      'DEPLOY_LOG_TAIL_BYTES',
      { min: 1024, max: 262144, fallback: 32768 },
    ),
    hostLogBytes: positiveInt(env.DEPLOY_HOST_LOG_BYTES, 'DEPLOY_HOST_LOG_BYTES', {
      min: 65536,
      max: 8388608,
      fallback: 1048576,
    }),
    maxParallel: positiveInt(env.DEPLOY_MAX_PARALLEL, 'DEPLOY_MAX_PARALLEL', {
      min: 1,
      max: 8,
      fallback: 2,
    }),
  };
  if (deploy.logTailBytes > deploy.hostLogBytes) {
    // хвост панели вырезается из кэпа на хосте: больший хвост был бы обещанием,
    // которое shell не может выполнить
    throw new Error(
      `Invalid DEPLOY_HOST_LOG_BYTES=${env.DEPLOY_HOST_LOG_BYTES}: must be >= DEPLOY_LOG_TAIL_BYTES (${deploy.logTailBytes})`,
    );
  }
```

Хелпер рядом с остальными парсерами (после `parsePorts`, `app.config.ts:298`):

```ts
const ABSOLUTE_DIR_RE = /^\/[A-Za-z0-9._/-]{0,199}$/;

/**
 * Корень на хосте попадает в shell-строку, поэтому whitelist без `..`, пробелов,
 * кавычек и `$`: путь из env — не пользовательский ввод, но инвариант
 * «в shell уходит только проверенное» не должен зависеть от этого.
 */
function parseAbsoluteDir(raw: string | undefined): string {
  const value = (raw ?? '/opt/bios-deploy').trim();
  if (!ABSOLUTE_DIR_RE.test(value) || value.includes('..')) {
    throw new Error(
      `Invalid DEPLOY_ROOT_DIR="${raw}": expected an absolute path without ".." or shell metacharacters`,
    );
  }
  return value;
}
```

В `return { … }` (`app.config.ts:471+`) рядом с `docker,`:

```ts
    deploy,
```

- [x] **Step 3: Прогнать конфиг**

Run: `npx jest src/config` → Expected: все PASS (в `defaults equal live values` секция `deploy` не ассертится — там проверяются только существующие группы; не расширять без причины).

- [x] **Step 4: Дополнить фикстуру**

В `src/config/testing/app-config.fixture.ts` signature и тело:

```ts
export function testAppConfig(
  overrides: Partial<AppConfig['ssh']> = {},
  dockerOverrides: Partial<AppConfig['docker']> = {},
  deployOverrides: Partial<AppConfig['deploy']> = {},
): AppConfig {
```

и в возвращаемом объекте после блока `docker: { … },`:

```ts
    deploy: {
      rootDir: '/tmp/bios-deploy',
      // Заметно меньше ssh.commandTimeoutMs: тест видит, какой дедлайн
      // исполнитель повесил на шаг, а не на всю операцию.
      stepTimeoutMs: 2000,
      logTailBytes: 512,
      hostLogBytes: 65536,
      // Один слот: последовательность «claim → шаги → finalize» наблюдаема
      // в тестах без гонок, а реальные 2 слота проверяются отдельным тестом.
      maxParallel: 1,
      ...deployOverrides,
    },
```

Run: `npx tsc --noEmit -p tsconfig.json` → Expected: пусто (единственный источник ошибок тут — незакрытая секция в `as AppConfig`, фикстура приводит к типу, поэтому проверяем сборкой).

- [x] **Step 5: Сборка, линт, коммит**

```bash
cd app/backend && npm run build && npx eslint src/config && npx prettier --write "src/config/**/*.ts"
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/config
git commit -m "feat(backend): deploy config section with per-step deadline and log tail

logTailBytes существует из-за замера: node-ssh складывает ВЕСЬ stdout в память
панели и режет его только на выдаче, поэтому хвост отрезается на хосте, а не в
исполнителе. stepTimeoutMs отдельный от ssh.commandTimeoutMs: docker build
легально идёт минуты, а exec части 3 на это не рассчитан.
"
```

---

## Task 3: `ProjectsService` — проект = публичный HTTPS-репозиторий

**Files:**
- Create: `app/backend/src/modules/projects/dto/create-project.dto.ts`
- Create: `app/backend/src/modules/projects/dto/project-ids.dto.ts`
- Create: `app/backend/src/modules/projects/project.types.ts`
- Modify: `app/backend/src/modules/projects/projects.service.ts` (сейчас 4 строки)
- Modify: `app/backend/src/modules/projects/projects.controller.ts` (сейчас 7 строк, префикс уже верный)
- Modify: `app/backend/src/modules/projects/projects.module.ts`
- Create: `app/backend/src/modules/projects/projects.service.spec.ts`

**Interfaces:**
- Consumes: `WorkspacesService.requireMembership(userId, workspaceId, roles)` (`workspaces.service.ts:116-130`), `MEMBER_ROLES`/`OWNER_ONLY_ROLES` (`servers.service.ts:37-41`), `DISPLAY_NAME_PATTERN` (`display-name.validator.ts:11`), `@User()`/`JwtUserPayload` (`common/decorators/user.decorator.ts`), `JwtAuthGuard` (`modules/auth/guards/jwt-auth.guard.ts`), `ConflictException`-конвенция `mapConflict` (образец: `servers.service.ts:506-515`).
- Produces:

```ts
// project.types.ts
export interface ProjectResponse {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  createdAt: Date;
  updatedAt: Date;
}
export const REPO_URL_RE: RegExp;
export function assertPublicHttpsRepoUrl(value: string): string;   // BadRequest на плохой

// dto/create-project.dto.ts
export class CreateProjectDto { name: string; repoUrl: string; }

// dto/project-ids.dto.ts
export class ProjectIdsDto { workspaceId: string; projectId: string; }  // не наследует ServerIdsDto

// projects.service.ts
create(userId: string, workspaceId: string, dto: CreateProjectDto): Promise<ProjectResponse>;
findAll(userId: string, workspaceId: string): Promise<ProjectResponse[]>;
findOne(userId: string, workspaceId: string, projectId: string): Promise<ProjectResponse>;
requireRow(projectId: string, workspaceId: string): Promise<Project>;   // 404, для Task 4/6
```

- [x] **Step 1: Падающий юнит на валидатор URL**

Create `src/modules/projects/project.types.ts` только с регуляркой и функцией, и сразу спеку `src/modules/projects/projects.service.spec.ts` (в ней же потом вырастут сервисные тесты):

```ts
import { BadRequestException } from '@nestjs/common';
import { assertPublicHttpsRepoUrl } from './project.types';

describe('repoUrl — только публичный HTTPS', () => {
  test(' принимает обычные https-репозитории и нормализует только хост', () => {
    expect(
      assertPublicHttpsRepoUrl('https://GitHub.com/octocat/Hello-World.git'),
    ).toBe('https://github.com/octocat/Hello-World.git');
    expect(
      assertPublicHttpsRepoUrl('https://gitlab.com/group/sub/repo'),
    ).toBe('https://gitlab.com/group/sub/repo');
    expect(assertPublicHttpsRepoUrl(' https://host.example/a/b ')).toBe(
      'https://host.example/a/b',
    );
  });

  test(' регистр пути сохраняется: репозиторий Group/MyRepo ≠ group/myrepo', () => {
    // замер (Node 26, WHATWG URL): new URL('https://GitHub.com/Owner/Repo.Git')
    // даёт hostname 'github.com' и pathname '/Owner/Repo.Git' — путь сам по
    // себе не меняется, а toLowerCase() всего строки его портил
    expect(
      assertPublicHttpsRepoUrl('https://gitlab.com/Team/MyApp.git'),
    ).toBe('https://gitlab.com/Team/MyApp.git');
  });

  test(' отклоняет credentials в URL: секрет не имеет права попадать в БД', () => {
    for (const bad of [
      'https://user:token@github.com/a/b.git',
      'https://x-oauth-basic@github.com/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет не-https, shell-метасимволы и адреса вне диапазона портов', () => {
    for (const bad of [
      'http://github.com/a/b',
      'git@github.com:a/b.git',
      'https://github.com/a/b; rm -rf /',
      'https://github.com/a/$(id)',
      "https://github.com/a/'b",
      'https://github.com/a b',
      'https:///a',
      'x'.repeat(501),
      // порт: 5 цифр из прошлой регулярки пропускали 99999, и new URL бросал
      // TypeError → 500 вместо 400 (замер: URL THROWS: TypeError)
      'https://github.com:99999/a/b',
      'https://github.com:65536/a/b',
      'https://github.com:0/a/b',
      'https://github.com:00080/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет адресные цели, чтобы хост не ходил в link-local', () => {
    for (const bad of [
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/a/b',
      'https://127.0.0.1:8443/a/b',
      'https://0/a',
      'https://[::1]/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет приватные имена и хосты без точки', () => {
    for (const bad of [
      'https://git.internal/a/b',
      'https://host.local/a/b',
      'https://srv.corp/a/b',
      'https://box.lan/a/b',
      'https://git/a',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });
});
```

Run: `npx jest src/modules/projects` → Expected: FAIL (`Cannot find module './project.types'`).

- [x] **Step 2: Реализовать `project.types.ts`**

```ts
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
const PRIVATE_HOST_RE = /\.(local|internal|intranet|corp|lan|home|localdomain)$/;

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
    throw new BadRequestException('repoUrl is required and must be ≤ 500 characters');
  }
  if (!REPO_URL_RE.test(trimmed)) {
    throw new BadRequestException(
      'repoUrl must be a public https://host/path without credentials, spaces or shell metacharacters',
    );
  }
  // Хост приводит к нижнему регистру сам WHATWG-парсер; путь остаётся каким его
  // дал пользователь: для git-сервера `Group/MyRepo` и `group/myrepo` — разные
  // репозитории (ревью №5).
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
```

Проверки `10.` и `192.168.` — страховка не от литералов (их уже отсекает последнее условие), а от имен вида `10.0.0.5.nip.io`, которые регипст-сервисы отдают наружу как домен. Забор синтаксический, и в Known gaps это названо прямо: панель не резолвит имя, поэтому полноценная SSRF-проверка адреса для `git clone` возможна только на самом хосте (который панель не контролирует) либо через DNS-прейлок на панели — это сознательная граница среза, а не забытая.

`new URL(...)` после regex, а не вместо: regex запрещает credentials и метасимволы, `URL` даёт hostname для адресной проверки. IPv4-литерал отклоняется последним условием (`/^\d+\.\d+\.\d+\.\d+$/`), потому что доменное имя в regex обязано заканчиваться буквенным TLD.

- [x] **Step 3: DTO**

Create `src/modules/projects/dto/create-project.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  /** Форму проверяет regex; нормализацию и адресные запреты — сервис. */
  @Transform(trim)
  @IsString()
  @Length(8, 500)
  repoUrl: string;
}
```

Create `src/modules/projects/dto/project-ids.dto.ts`:

```ts
import { IsUUID } from 'class-validator';
import { ServerIdsDto } from '../../servers/dto/server-ids.dto';

/** `workspaceId`/`serverId` наследуют @IsUUID('7'); здесь вместо сервера — проект. */
export class ProjectIdsDto {
  @IsUUID('7')
  workspaceId: string;

  @IsUUID('7')
  projectId: string;
}
```

(Не расширяет `ServerIdsDto`: `serverId` в пути проектов отсутствует, а наследование добавило бы обязательное поле, которого в маршруте нет.)

- [x] **Step 4: Падающие тесты сервиса**

Дополнить `src/modules/projects/projects.service.spec.ts` вторым `describe` (по образцу `servers.spec.ts:60-100`: своя БД, реальные сервисы без Nest-обёртки). Импорты добавить к существующим в начале файла:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('ProjectsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
  let ownerId: string;
  let workspaceId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
    projects = new ProjectsService(prisma, workspaces);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ownerId = (
      await users.create({
        username: `pjowner${n}`,
        email: `pjowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `pj-ws-${n}` })).id;
  });

  afterEach(async () => {
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(overrides: Partial<CreateProjectDto> = {}): CreateProjectDto {
    return {
      name: 'shop',
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      ...overrides,
    };
  }

  async function member(userId: string): Promise<void> {
    await prisma.workspaceMember.create({
      data: { workspaceId, userId, role: 'MEMBER' },
    });
  }

  test('create: OWNER, хост нормализован, путь сохранён, секретов в ответе нет', async () => {
    const created = await projects.create(
      ownerId,
      workspaceId,
      dto({ repoUrl: 'https://GitHub.com/octocat/Hello-World.git' }),
    );
    expect(created).toMatchObject({
      workspaceId,
      name: 'shop',
      // путь НЕ приводится к нижнему регистру (ревью №5): для git-сервера
      // Group/MyRepo и group/myrepo — разные репозитории
      repoUrl: 'https://github.com/octocat/Hello-World.git',
    });
    expect(JSON.stringify(created)).not.toContain('token');
  });

  test('create: MEMBER — 403, строки нет', async () => {
    const other = (
      await users.create({
        username: `pjmem${n}`,
        email: `pjmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await member(other);
    await expect(
      projects.create(other, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.project.count()).toBe(0);
  });

  test('create: чужой workspace — 404, а не «создам в чужом»', async () => {
    const stranger = (
      await users.create({
        username: `pjstr${n}`,
        email: `pjstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await expect(
      projects.create(stranger, workspaceId, dto()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('create: битый repoUrl — 400 до записи', async () => {
    await expect(
      projects.create(ownerId, workspaceId, dto({ repoUrl: 'http://github.com/a/b' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.project.count()).toBe(0);
  });

  test('create: дубликат имени в воркспейсе — 409', async () => {
    await projects.create(ownerId, workspaceId, dto());
    await expect(
      projects.create(ownerId, workspaceId, dto({ repoUrl: 'https://gitlab.com/a/b' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('list и findOne: только свои проекты чужому — 404', async () => {
    const mine = await projects.create(ownerId, workspaceId, dto());
    expect(await projects.findAll(ownerId, workspaceId)).toEqual([
      expect.objectContaining({ id: mine.id }),
    ]);
    const otherWs = await workspaces.create(ownerId, { name: 'pj-other' });
    await expect(
      projects.findOne(ownerId, otherWs.id, mine.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      projects.findOne(ownerId, workspaceId, mine.id),
    ).resolves.toMatchObject({ id: mine.id });
  });
});
```

Run: `npx jest src/modules/projects` → Expected: FAIL (`ProjectsService is not a constructor` / `projects.create is not a function`; тест `repoUrl`-блока из Step 1 уже зелёный).

- [x] **Step 5: Реализовать сервис**

Заменить содержимое `projects.service.ts` (4 строки) на:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { OWNER_ONLY_ROLES, MEMBER_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import { assertPublicHttpsRepoUrl, type ProjectResponse } from './project.types';

function toResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, OWNER_ONLY_ROLES);
    const repoUrl = assertPublicHttpsRepoUrl(dto.repoUrl);
    try {
      return toResponse(
        await this.prisma.project.create({
          data: { workspaceId, name: dto.name.trim(), repoUrl },
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('project name already exists');
      }
      throw err;
    }
  }

  async findAll(userId: string, workspaceId: string): Promise<ProjectResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  async findOne(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    return toResponse(await this.requireRow(projectId, workspaceId));
  }

  /**
   * 404, а не 403: чужой проект неотличим от несуществующего — то же правило,
   * что `requireRow` в servers.service.ts (часть 3).
   */
  async requireRow(projectId: string, workspaceId: string): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) throw new NotFoundException('project not found');
    return project;
  }
}
```

`MEMBER_ROLES`/`OWNER_ONLY_ROLES` импортируются из `../servers/servers.service` — те же константы, что у Docker-роутов (часть 4), новых списков не заводим.

- [x] **Step 6: Контроллер и модуль**

Заменить `projects.controller.ts` (7 строк) на:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectIdsDto } from './dto/project-ids.dto';
import { ProjectsService } from './projects.service';

@Controller('workspaces/:workspaceId/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  list(@User() user: JwtUserPayload, @Param() params: WorkspaceIdDto) {
    return this.projectsService.findAll(user.userId, params.workspaceId);
  }

  @Get(':projectId')
  one(@User() user: JwtUserPayload, @Param() params: ProjectIdsDto) {
    return this.projectsService.findOne(
      user.userId,
      params.workspaceId,
      params.projectId,
    );
  }
}
```

У каждого маршрута свой Param-DTO, и это не педантизм: глобальный `ValidationPipe` в `main.ts:29-33` стоит с `whitelist/forbidNonWhitelisted/transform` и **без** `skipMissingProperties`, то есть обязательное поле DTO, которого нет в пути, даёт 400 на живом запросе. `create`/`list` живут на `…/projects` без `:projectId` — поэтому `WorkspaceIdDto`, как в `servers.controller.ts:31-35` (там `create` тоже берёт `WorkspaceIdDto`, а `findOne` — `ServerIdsDto`). `@Param() params: ProjectIdsDto` на `@Get(':projectId')` работает потому, что имена маршрута и поля совпадают.

Заменить `projects.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule, WorkspacesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

`exports: [ProjectsService]` — нужен Task 4 (deploy-configs) и Task 6 (исполнитель читает проект).

- [x] **Step 7: Прогнать, проверить сборку**

```bash
cd app/backend && npx jest src/modules/projects && npx tsc --noEmit -p tsconfig.json && npm run build
```

Expected: все тесты PASS (включая блок `repoUrl`), tsc и сборка чистые.

- [x] **Step 8: Линт, форматирование, коммит**

```bash
cd app/backend && npx eslint src/modules/projects && npx prettier --write "src/modules/projects/**/*.ts"
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/modules/projects
git commit -m "feat(backend): project CRUD bound to a public https repository

repoUrl проверяется целиком, а не «на https и всё»: whitelist regex отсекает
credentials и shell-метасимволы (url уходит в git clone на хосте), адресная
проверка — link-local и IPv4-литералы, иначе OWNER мог бы заставить хост
сходить за метаданными облака. Приватных репозиториев в этом срезе нет,
поэтому полю секрета в схеме неоткуда взяться.
"
```

---

## Task 4: `DeployConfigsService` — конфигурация деплоя внутри проекта

**Files:**
- Create: `app/backend/src/modules/projects/dto/create-deploy-config.dto.ts`
- Create: `app/backend/src/modules/projects/deploy-configs.service.ts`
- Create: `app/backend/src/modules/projects/deploy-configs.service.spec.ts`
- Modify: `app/backend/src/modules/projects/project.types.ts` (валидаторы ref/dockerfile/containerName/ports + `DeployConfigResponse`)
- Modify: `app/backend/src/modules/projects/projects.service.spec.ts` (блок валидаторов)
- Modify: `app/backend/src/modules/projects/projects.controller.ts` (маршруты 4–5 из таблицы)
- Modify: `app/backend/src/modules/projects/projects.module.ts` (provider + export)

**Interfaces:**
- Consumes: `ProjectsService.requireRow(projectId, workspaceId)` (Task 3), `WorkspacesService.requireMembership`, `ProjectIdsDto` (Task 3).
- Produces:

```ts
// project.types.ts
export const GIT_REF_RE: RegExp;
export const RELATIVE_FILE_RE: RegExp;
export const CONTAINER_NAME_RE: RegExp;
export const PORT_MAP_RE: RegExp;
export function assertGitRef(value: string): string;
export function assertRelativeFilePath(value: string): string;
export function assertContainerName(value: string): string;
export function assertPortMappings(value: string[] | undefined): string[];
export interface DeployConfigResponse {
  id: string;
  projectId: string;
  serverId: string;
  name: string;
  method: 'GIT_PULL';
  ref: string;
  dockerfile: string;
  containerName: string;
  ports: string[];
  createdAt: Date;
  updatedAt: Date;
}

// dto/create-deploy-config.dto.ts
export class CreateDeployConfigDto {
  name: string; method: 'GIT_PULL'; ref: string; dockerfile?: string;
  containerName: string; ports?: string[]; serverId: string;
}
export const SUPPORTED_METHODS: readonly ['GIT_PULL'];

// deploy-configs.service.ts
@Injectable() class DeployConfigsService {
  create(userId, workspaceId, projectId, dto: CreateDeployConfigDto): Promise<DeployConfigResponse>;
  findAll(userId, workspaceId, projectId): Promise<DeployConfigResponse[]>;
  requireRow(configId: string, projectId: string): Promise<DeployConfig>;   // 404, для Task 6/7
}
```

- [x] **Step 1: Падающие тесты валидаторов**

Дополнить `src/modules/projects/projects.service.spec.ts` блоком (импорты `assertGitRef`, `assertRelativeFilePath`, `assertContainerName`, `assertPortMappings` добавить к существующим импортам из `./project.types`):

```ts
describe('валидаторы конфигурации деплоя', () => {
  test('ref: ветки и теги проходят, синтаксис git — нет', () => {
    for (const ok of ['main', 'release/1.2', 'v1.2.3-rc1', 'my_branch']) {
      expect(assertGitRef(ok)).toBe(ok);
    }
    for (const bad of [
      '-F', '..secret', 'a/..b', 'HEAD~1', 'main^', '@{0}', '', ' ', 'a b',
      'x'.repeat(101),
    ]) {
      expect(() => assertGitRef(bad)).toThrow(BadRequestException);
    }
  });

  test('dockerfile: только относительный путь внутри репозитория', () => {
    expect(assertRelativeFilePath('Dockerfile')).toBe('Dockerfile');
    expect(assertRelativeFilePath('docker/Dockerfile.prod')).toBe('docker/Dockerfile.prod');
    for (const bad of ['/etc/passwd', '../Dockerfile', './$(id)', 'a b', '-Dockerfile', 'x'.repeat(121)]) {
      expect(() => assertRelativeFilePath(bad)).toThrow(BadRequestException);
    }
  });

  test('containerName и ports: правила docker', () => {
    expect(assertContainerName('shop-web_1')).toBe('shop-web_1');
    for (const bad of ['-name', 'a b', 'a/b', 'a;rm', '', 'x'.repeat(65)]) {
      expect(() => assertContainerName(bad)).toThrow(BadRequestException);
    }
    expect(assertPortMappings(['8080:80', '9000:443/tcp'])).toEqual(['8080:80', '9000:443/tcp']);
    expect(assertPortMappings(undefined)).toEqual([]);
    for (const bad of ['0:80', '80:0', '99999:80', '8080:80:80', 'http', '8080:80 /udp', "8080:80'"]) {
      expect(() => assertPortMappings([bad])).toThrow(BadRequestException);
    }
  });

  test('дубли хост-порта отклоняются по нормализованному значению (ревью)', () => {
    expect(() => assertPortMappings(['8080:80', '8080:443'])).toThrow(BadRequestException);
    // ведущие нули — тот же порт, и docker отказал бы с тем же текстом
    expect(() => assertPortMappings(['08080:80', '8080:443'])).toThrow(BadRequestException);
    // разные протоколы одного хост-порта docker разрешает
    expect(assertPortMappings(['8080:80/tcp', '8080:80/udp'])).toEqual([
      '8080:80/tcp',
      '8080:80/udp',
    ]);
  });
});
```

Run: `npx jest src/modules/projects` → Expected: FAIL (`assertGitRef is not a function`).

- [x] **Step 2: Реализовать валидаторы в `project.types.ts`**

Дополнить файл после `assertPublicHttpsRepoUrl` (без новых импортов — `BadRequestException` уже в начале):

```ts
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
 * НОРМАЛИЗОВАННЫЙ номер и протокол (ревью, «остальное»): `08080:80` и `8080:80`
 * — один и тот же занятый порт, а `8080:80/tcp` и `8080:80/udp` — разные, и
 * docker их разрешает одновременно.
 */
export function assertPortMappings(value: string[] | undefined): string[] {
  const ports = (value ?? []).map((entry) => entry.trim());
  const seen = new Set<string>();
  for (const entry of ports) {
    const match = PORT_MAP_RE.exec(entry);
    if (!match) {
      reject(entry, 'each port mapping must look like host:container or host:container/tcp');
    }
    const hostPort = Number(match![1]);
    const containerPort = Number(match![2]);
    if (hostPort < 1 || hostPort > 65535 || containerPort < 1 || containerPort > 65535) {
      reject(entry, 'port numbers must be 1-65535');
    }
    const key = `${hostPort}/${match![3] ?? 'tcp'}`;
    if (seen.has(key)) {
      reject(entry, `host port ${hostPort}/${match![3] ?? 'tcp'} is mapped twice`);
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
```

`GIT_REF_RE` включает `~^{}-` в класс, а `assertGitRef` их отдельно выбрасывает — так сообщение остаётся полезным («это синтаксис ревизий»), а не «символ не из того набора». Оба теста из Step 1 это фиксируют.

- [x] **Step 3: DTO конфигурации**

Create `src/modules/projects/dto/create-deploy-config.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import {
  CONTAINER_NAME_RE,
  GIT_REF_RE,
  RELATIVE_FILE_RE,
} from '../project.types';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Единственный исполняемый метод среза 1 (см. Task 1 Step 5). */
export const SUPPORTED_METHODS = ['GIT_PULL'] as const;

export class CreateDeployConfigDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  @IsIn(SUPPORTED_METHODS as unknown as string[], {
    message:
      'method must be GIT_PULL (compose, shell script и custom commands — следующий срез)',
  })
  method: 'GIT_PULL';

  @Transform(trim)
  @IsString()
  @Matches(GIT_REF_RE, {
    message: 'ref must be a plain branch or tag name',
  })
  ref: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(RELATIVE_FILE_RE, {
    message: 'dockerfile must be a relative path inside the repository',
  })
  dockerfile?: string;

  @Transform(trim)
  @IsString()
  @Matches(CONTAINER_NAME_RE, { message: 'containerName must be a docker container name' })
  containerName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ports?: string[];

  /** UUIDv7 сервера того же воркспейса; чужой serverId → 404 в сервисе. */
  @IsUUID('7')
  serverId: string;
}
```

Формат id — `@IsUUID('7')`, как в `server-ids.dto.ts:4-8` и `workspace-id.dto.ts:4`: в схеме все первичные ключи `@default(uuid(7))`, и мягче проверять нельзя — иначе в тело create просочился бы id, который никогда не был сгенерирован.

(Отдельного `deploy-config-ids.dto.ts` в этом срезе нет: маршруты 4–5 дают в пути только `workspaceId` + `projectId`, поэтому они берут `ProjectIdsDto` из Task 3. DTO с обязательным `configId` появился бы раньше, чем маршрут, который его содержит, — а `@Get(…/deploy-configs/:configId)` вне среза.)

Зачем сервис снова вызывает `assert*`, если DTO проверяет regex'ами: DTO защищает границу HTTP, `assert*` — границу данных. Исполнитель (Task 6) читает строку из БД, где значение могло появиться не только через контроллер (сид в тесте, будущий импорт), и канонизация обязана происходить ровно в одном месте — как с `assertPublicHttpsRepoUrl` в Task 3.

- [x] **Step 4: Падающие тесты сервиса**

Create `src/modules/projects/deploy-configs.service.spec.ts` (своя база `bios_test_deploy_configs` — два файла на одной базе дерутся через глобальный `deleteMany`, см. Global Constraints; тот же порядок `afterEach`, что в `projects.service.spec.ts`: `deployment → deployConfig → project → server → …`):

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DeployConfigsService } from './deploy-configs.service';
import type { CreateDeployConfigDto } from './dto/create-deploy-config.dto';
import { ProjectsService } from './projects.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy_configs?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('DeployConfigsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
  let configs: DeployConfigsService;
  let ownerId: string;
  let workspaceId: string;
  let projectId: string;
  let serverId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
    projects = new ProjectsService(prisma, workspaces);
    configs = new DeployConfigsService(prisma, workspaces, projects);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ownerId = (
      await users.create({
        username: `cfowner${n}`,
        email: `cfowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `cf-ws-${n}` })).id;
    projectId = (
      await projects.create(ownerId, workspaceId, {
        name: 'shop',
        repoUrl: 'https://github.com/octocat/Hello-World.git',
      })
    ).id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: `cf-srv-${n}`,
        host: '203.0.113.40',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    serverId = server.id;
  });

  afterEach(async () => {
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(
    overrides: Partial<CreateDeployConfigDto> = {},
  ): CreateDeployConfigDto {
    return {
      name: 'prod',
      method: 'GIT_PULL',
      ref: 'master',
      containerName: 'shop-web',
      serverId,
      ...overrides,
    };
  }

  test('create: dockerfile по умолчанию, пустые ports, поля на месте', async () => {
    const created = await configs.create(ownerId, workspaceId, projectId, dto());
    expect(created).toMatchObject({
      projectId,
      serverId,
      name: 'prod',
      method: 'GIT_PULL',
      ref: 'master',
      dockerfile: 'Dockerfile',
      containerName: 'shop-web',
      ports: [],
    });
  });

  test('create: ports сохраняются как заданы', async () => {
    const created = await configs.create(ownerId, workspaceId, projectId, dto({
      ports: ['8080:80', '9000:443/tcp'],
    }));
    expect(created.ports).toEqual(['8080:80', '9000:443/tcp']);
  });

  test('create: сервер из другого воркспейса — 404 и ни одной строки', async () => {
    const otherWs = await workspaces.create(ownerId, { name: 'cf-other' });
    const foreign = await prisma.server.create({
      data: {
        workspaceId: otherWs.id,
        name: 'elsewhere',
        host: '203.0.113.41',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({ serverId: foreign.id })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.deployConfig.count()).toBe(0);
  });

  test('create: несуществующий serverId — тоже 404', async () => {
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({
        serverId: '01912345-6789-7abc-aef0-1234567890ff',
      })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('create: не-GIT_PULL метод — 400 с текстом про следующий срез', async () => {
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({
        method: 'COMPOSE' as unknown as 'GIT_PULL',
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('create: MEMBER — 403; дубль имени и дубль containerName — 409', async () => {
    const member = (
      await users.create({
        username: `cfmem${n}`,
        email: `cfmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: member, role: 'MEMBER' },
    });
    await expect(
      configs.create(member, workspaceId, projectId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await configs.create(ownerId, workspaceId, projectId, dto());
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({ ref: 'main' })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({ name: 'staging' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('list: только конфигурации этого проекта', async () => {
    await configs.create(ownerId, workspaceId, projectId, dto());
    const other = await projects.create(ownerId, workspaceId, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await configs.create(ownerId, workspaceId, other.id, dto({ containerName: 'blog-web' }));
    const rows = await configs.findAll(ownerId, workspaceId, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].containerName).toBe('shop-web');
  });

  test('containerName уникален в пределах СЕРВЕРА, а не проекта (ревью №3)', async () => {
    await configs.create(ownerId, workspaceId, projectId, dto());
    const blog = await projects.create(ownerId, workspaceId, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    // другой проект, тот же сервер, то же имя контейнера: второй деплой сделал бы
    // `docker rm -f shop-web` и убил сервис первого проекта
    await expect(
      configs.create(ownerId, workspaceId, blog.id, dto({ name: 'prod-2' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.deployConfig.count()).toBe(1);

    // а на другом сервере то же имя — законно
    const second = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-2',
        host: '203.0.113.42',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    const onOtherServer = await configs.create(
      ownerId,
      workspaceId,
      blog.id,
      dto({ name: 'prod-2', serverId: second.id }),
    );
    expect(onOtherServer.containerName).toBe('shop-web');
  });
});
```

Run: `npx jest src/modules/projects/deploy-configs` → Expected: FAIL (`Cannot find module './deploy-configs.service'`).

- [x] **Step 5: Реализовать `deploy-configs.service.ts`**

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeployConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateDeployConfigDto } from './dto/create-deploy-config.dto';
import {
  assertContainerName,
  assertGitRef,
  assertPortMappings,
  assertRelativeFilePath,
  type DeployConfigResponse,
} from './project.types';
import { ProjectsService } from './projects.service';

function toResponse(row: DeployConfig): DeployConfigResponse {
  return {
    id: row.id,
    projectId: row.projectId,
    serverId: row.serverId,
    name: row.name,
    // Метод сужен DTO на create; приведение держит тип ответа узким —
    // исполнитель среза 1 знает один метод.
    method: row.method as 'GIT_PULL',
    ref: row.ref,
    dockerfile: row.dockerfile,
    containerName: row.containerName,
    ports: row.ports,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DeployConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projects: ProjectsService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    projectId: string,
    dto: CreateDeployConfigDto,
  ): Promise<DeployConfigResponse> {
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );
    const project = await this.projects.requireRow(projectId, workspaceId);

    // Чужой или несуществующий сервер — 404 одинаково: неотличимость как в
    // `requireRow` серверов (часть 3), а не «400, у меня нет такого id».
    const server = await this.prisma.server.findFirst({
      where: { id: dto.serverId, workspaceId },
    });
    if (!server) throw new NotFoundException('server not found');

    try {
      return toResponse(
        await this.prisma.deployConfig.create({
          data: {
            projectId: project.id,
            serverId: server.id,
            name: dto.name.trim(),
            method: dto.method,
            ref: assertGitRef(dto.ref),
            dockerfile: assertRelativeFilePath(dto.dockerfile ?? 'Dockerfile'),
            containerName: assertContainerName(dto.containerName),
            ports: assertPortMappings(dto.ports),
          },
        }),
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'deploy config name exists in this project, or containerName is already used on this server',
        );
      }
      throw err;
    }
  }

  async findAll(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<DeployConfigResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const project = await this.projects.requireRow(projectId, workspaceId);
    const rows = await this.prisma.deployConfig.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  /** Исполнителю (Task 6) нужна строка целиком, включая `serverId`. */
  async requireRow(configId: string, projectId: string): Promise<DeployConfig> {
    const row = await this.prisma.deployConfig.findFirst({
      where: { id: configId, projectId },
    });
    if (!row) throw new NotFoundException('deploy config not found');
    return row;
  }
}
```

`method: dto.method` — тип `'GIT_PULL'` из DTO присваивается полю `DeployMethod` без каста (литерал входит в enum); проверит `tsc` в Step 7.

- [x] **Step 6: Маршруты 4–5 и модуль**

Дополнить `projects.controller.ts` (в конструктор добавить `private readonly deployConfigsService: DeployConfigsService`):

```ts
  @Post(':projectId/deploy-configs')
  createConfig(
    @User() user: JwtUserPayload,
    @Param() params: ProjectIdsDto,
    @Body() dto: CreateDeployConfigDto,
  ) {
    return this.deployConfigsService.create(
      user.userId,
      params.workspaceId,
      params.projectId,
      dto,
    );
  }

  @Get(':projectId/deploy-configs')
  listConfigs(
    @User() user: JwtUserPayload,
    @Param() params: ProjectIdsDto,
  ) {
    return this.deployConfigsService.findAll(
      user.userId,
      params.workspaceId,
      params.projectId,
    );
  }
```

В `projects.controller.ts` нужен импорт `ProjectIdsDto` (уже есть из Task 3) и `CreateDeployConfigDto`; `deploy-configs.dto`-файл с `configId` не создаётся. Пути этих маршрутов совпадают с `API.md:109-110` (`workspaces/:workspace_id/projects/:project_id/deploy-configs`), а `workspaceId` из пути — единственный источник области видимости: `projectId` сам по себе не доказывает, что проект принадлежит воркспейсу, и `requireRow(projectId, workspaceId)` в сервисе это и проверяет.

В `projects.module.ts`: `providers: [ProjectsService, DeployConfigsService]`, `exports: [ProjectsService, DeployConfigsService]`.

Run: `npx jest src/modules/projects` → Expected: все PASS.

- [x] **Step 7: Полный чек и коммит**

```bash
cd app/backend && npx tsc --noEmit -p tsconfig.json && npm run build && npx eslint src/modules/projects && npx prettier --write "src/modules/projects/**/*.ts"
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/modules/projects
git commit -m "feat(backend): deploy config crud with git-safe field validation

ref, dockerfile, containerName и ports проверяются дважды: regex'ом в DTO
(граница HTTP) и assert-функциями в сервисе (граница данных), потому что в
shell значения уходят из исполнителя, который читает строку из БД. Ведущий
дефис в ref и `..` в dockerfile отклоняются не «на всякий случай»: git видит
в `-F` опцию, а в `main^` — синтаксис ревизий, и деплой молча ушёл бы не туда.
"
```

---

## Task 5: `deploy-script.ts` — план из четырёх шагов и песочница

**Files:**
- Create: `app/backend/src/modules/deployments/deployment.types.ts`
- Create: `app/backend/src/modules/deployments/deploy-script.ts`
- Create: `app/backend/src/modules/deployments/deploy-script.spec.ts`
- Create: `app/backend/src/modules/deployments/deploy-script.sandbox.spec.ts`

**Interfaces:**
- Consumes: `priv`, `shq` (`../servers/agent/shell-quote.ts`), коды preflight-конвенции 42/45/46 (`../servers/agent/agent-script.ts:140-150`), `DeployCfg` (Task 2).
- Produces:

```ts
// deployment.types.ts
export type DeployErrorCode = 'GIT_MISSING' | 'DOCKER_MISSING' | 'DOCKER_PERMISSION_DENIED'
  | 'DOCKER_SOCKET_UNREACHABLE' | 'REF_NOT_FOUND' | 'DOCKERFILE_MISSING' | 'SOURCE_FAILED'
  | 'BUILD_FAILED' | 'RUN_FAILED' | 'TIMEOUT' | 'HOST_UNREACHABLE' | 'AUTH_FAILED' | 'REFUSED'
  | 'DNS' | 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH' | 'SNAPSHOT_INVALID'
  | 'PANEL_RESTARTED' | 'ACCESS_LOST' | 'COMMAND_FAILED';
export type DeployStepName = 'preflight' | 'source' | 'build' | 'run';
export interface DeploymentResponse { … }        // см. код ниже
export interface DeploymentLogsResponse { … }
export interface DeploySnapshot { method: 'GIT_PULL'; ref: string; dockerfile: string;
  containerName: string; ports: string[]; repoUrl: string }

// deploy-script.ts
export interface DeployPaths { root: string; srcDir: string; logDir: string }
export function deployPaths(rootDir: string, projectId: string, configId: string): DeployPaths;
export interface StepCommand { step: DeployStepName; command: string }
export interface DeployPlanInput { paths: DeployPaths; root: boolean; repoUrl: string;
  ref: string; dockerfile: string; imageTag: string; containerName: string;
  ports: string[]; logTailBytes: number; hostLogBytes: number }
export function buildDeployPlan(input: DeployPlanInput): StepCommand[];   // всегда ровно 4
export function deployCodeOfSsh(code: SshErrorCode): DeployErrorCode;   // маппинг кодов шва
export interface StepResult {
  code: number | null;
  /** Маркеры ТОЛЬКО из служебной области до `BIOS_LOG_BEGIN`. */
  markers: Record<string, string>;
  log: string;
  /** Конверт собран обёрткой целиком: есть и BEGIN, и END. */
  protocolOk: boolean;
}
export function parseStepResult(stdout: string, stderr: string, code: number | null): StepResult;
export function deployErrorCodeOf(step: DeployStepName, result: StepResult): DeployErrorCode | null;
export function toPrismaStep(step: DeployStepName): 'PREFLIGHT' | 'SOURCE' | 'BUILD' | 'RUN';
export const DEPLOY_EXIT_CODES: { DOCKER: 42; SYSTEMD: 43; DOCKER_PERM: 45;
  DOCKER_SOCKET: 46; GIT: 50; REF: 51; SOURCE: 52; BUILD: 53; RUN: 54; DOCKERFILE: 55 };
```

`imageTag` — строка, которую вычисляет исполнитель (Task 6), а не билдер: SHA коммита известен только после шага `source`, поэтому тег привязан к `id` самого деплоя, и план собирается одним проходом до первого `exec`. Билдер от формата не зависит — в тестах это произвольная строка.

- [x] **Step 1: Типы ошибок и ответов**

Create `src/modules/deployments/deployment.types.ts`:

```ts
import type { DeploymentStatus } from '@prisma/client';

/**
 * Словарь кодов деплоя. Живёт в TypeScript, а не enum'ом в БД: список
 * пополняется без DDL — тот же приём, что `Server.lastAgentErrorCode`
 * (schema.prisma:138).
 */
export type DeployErrorCode =
  | 'GIT_MISSING'
  | 'DOCKER_MISSING'
  | 'DOCKER_PERMISSION_DENIED'
  | 'DOCKER_SOCKET_UNREACHABLE'
  | 'REF_NOT_FOUND'
  | 'DOCKERFILE_MISSING'
  | 'SOURCE_FAILED'
  | 'BUILD_FAILED'
  | 'RUN_FAILED'
  | 'TIMEOUT'
  | 'HOST_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'REFUSED'
  | 'DNS'
  | 'HOST_KEY_NOT_TRUSTED'
  | 'HOST_KEY_MISMATCH'
  | 'SNAPSHOT_INVALID'
  | 'PANEL_RESTARTED'
  | 'ACCESS_LOST'
  | 'COMMAND_FAILED';

export type DeployStepName = 'preflight' | 'source' | 'build' | 'run';

export interface DeploymentResponse {
  id: string;
  projectId: string;
  configId: string;
  status: DeploymentStatus;
  /** NULL, пока задача в очереди. */
  step: DeployStepName | null;
  /** Полное имя образа: `bios-deploy:<id деплоя>`; задел среза rollback. */
  imageTag: string | null;
  commitSha: string | null;
  containerId: string | null;
  errorCode: DeployErrorCode | null;
  exitCode: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Длительность отдельным полем: её просят в метрике спринта, и UI не должен
   *  вычитать даты, у которых `finishedAt` может быть NULL. */
  durationMs: number | null;
  triggeredById: string;
  createdAt: Date;
}

export interface DeploymentLogsResponse {
  deploymentId: string;
  status: DeploymentStatus;
  finished: boolean;
  log: string;
  sizeBytes: number;
}

/**
 * Снимок конфигурации на момент постановки в очередь. Исполнитель строит план
 * ИМЕННО из него (ревью №7): правка конфигурации между `POST /deployments` и
 * стартом задачи не должна менять то, что уже обещано пользователю. Поле `Json?`
 * в БД, поэтому форма проверяется на чтении, а не на записи.
 */
export interface DeploySnapshot {
  method: 'GIT_PULL';
  ref: string;
  dockerfile: string;
  containerName: string;
  ports: string[];
  repoUrl: string;
}

/** `null` — снимок не читается: у задачи нет права исполнять что-то наугад. */
export function toDeploySnapshot(raw: unknown): DeploySnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.method !== 'GIT_PULL' ||
    typeof value.ref !== 'string' ||
    typeof value.dockerfile !== 'string' ||
    typeof value.containerName !== 'string' ||
    typeof value.repoUrl !== 'string' ||
    !Array.isArray(value.ports) ||
    !value.ports.every((port) => typeof port === 'string')
  ) {
    return null;
  }
  return {
    method: 'GIT_PULL',
    ref: value.ref,
    dockerfile: value.dockerfile,
    containerName: value.containerName,
    ports: value.ports as string[],
    repoUrl: value.repoUrl,
  };
}
```

Четыре кода добавлены по ревью, и каждый — про различимую причину, а не про длину списка:

- `HOST_KEY_MISMATCH` — запиненный отпечаток перестал совпадать (ключ хоста сменился или путь перехвачен). Это не `HOST_KEY_NOT_TRUSTED` («мы ещё не подтверждали») и не `HOST_UNREACHABLE` («хост не отвечает»): оператор должен различать «ждёт подтверждения» и «доверие сломалось», иначе диагноз врёт.
- `AUTH_FAILED` — хост отвечает, порт открыт, дошли до аутентификации и не прошли её: дело в ключе или пароле, а не в связности. `HOST_UNREACHABLE` тут скрыл бы важное (ревью, блок «остальное»).
- `REFUSED` и `DNS` — порт закрыт и имя не разрешается; это разные действия (сокет против DNS-имени), и оба не «сеть вообще».
- `SNAPSHOT_INVALID` — снимок конфигурации в задаче не читается как план деплоя (см. Task 6: исполнитель строит план из `snapshot`, а не из живых полей).

`ACCESS_LOST` появляется в словаре заранее, но заполняет его исполнитель (Task 6): задача могла простоять в очереди, а участник, её запустивший, к моменту старта уже вышед из воркспейса. Это не `HOST_UNREACHABLE` (хост в порядке) и не `COMMAND_FAILED` (команда не исполнялась) — отдельный код, иначе диагноз «почему не задеплоилось» соврёт.

`DeployStepName` существует и как Prisma-enum `PREFLIGHT SOURCE BUILD RUN` (Task 1): в shell-протоколе шаги — строчные маркеры, в БД — enum. Конверсия `toPrismaStep` (Step 3) обязательна и покрыта тестом, иначе `PREFLIGHT` ≠ `preflight` тихо потерял бы статус шага. В Nest-код Prisma-версия этого enum'а не импортируется — она называется так же и затенила бы строчный тип; в `data.step` хватает строковых литералов, Prisma принимает их как значения enum'а.

- [x] **Step 2: Падающий юнит на билдер, парсер и классификатор**

Create `src/modules/deployments/deploy-script.spec.ts`:

```ts
import {
  DEPLOY_EXIT_CODES,
  buildDeployPlan,
  deployCodeOfSsh,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  toPrismaStep,
  type DeployPlanInput,
  type DeployStepName,
  type StepResult,
} from './deploy-script';
import { toDeploySnapshot } from './deployment.types';

const PATHS = deployPaths('/opt/bios-deploy', 'proj-1', 'cfg-1');

function plan(overrides: Partial<DeployPlanInput> = {}): ReturnType<typeof buildDeployPlan> {
  return buildDeployPlan({
    paths: PATHS,
    root: true,
    repoUrl: 'https://github.com/octocat/hello-world.git',
    ref: 'master',
    dockerfile: 'Dockerfile',
    imageTag: 'bios-deploy:01912345-6789-7abc-aef0-1234567890ff',
    containerName: 'shop-web',
    ports: ['8080:80', '9000:443/tcp'],
    logTailBytes: 4096,
    hostLogBytes: 65536,
    ...overrides,
  });
}

describe('buildDeployPlan', () => {
  test('всегда четыре шага в порядке preflight → source → build → run', () => {
    expect(plan().map((entry) => entry.step)).toEqual([
      'preflight',
      'source',
      'build',
      'run',
    ]);
  });

  test('каждый шаг печатает протокол и режет лог дважды: на хосте и в панель', () => {
    for (const entry of plan()) {
      expect(entry.command).toContain(`printf 'BIOS_STEP=%s\\n' '${entry.step}'`);
      expect(entry.command).toContain('BIOS_RC=');
      expect(entry.command).toContain('BIOS_LOG_BEGIN');
      expect(entry.command).toContain('BIOS_LOG_END');
      // Замер (п.7): node-ssh копит весь stdout в памяти панели → хвост режем там.
      expect(entry.command).toContain('tail -c 4096');
      // Ревью: и файл на хосте ограничен, иначе диск клиента растёт с каждой сборкой.
      expect(entry.command).toContain('tail -c 65536');
    }
  });

  test('шаг source проверяет ref без конвейера и хранит полный SHA', () => {
    const source = plan()[1].command;
    // `| grep -q .` вернул бы статус grep: сетевой отказ стал бы REF_NOT_FOUND
    expect(source).not.toContain('| grep');
    expect(source).toContain('ls-remote --heads --tags');
    expect(source).toContain('> \'/opt/bios-deploy/proj-1/cfg-1/logs/source.probe\'');
    expect(source).toContain('[ -s \'/opt/bios-deploy/proj-1/cfg-1/logs/source.probe\' ]');
    expect(source).toContain('rev-parse HEAD');
    expect(source).not.toContain('rev-parse --short');
  });

  test('значения с кавычками и подстановкой экранированы', () => {
    const joined = plan({
      repoUrl: 'https://github.com/a/$(touch /tmp/pwned).git',
      ref: 'main',
      containerName: 'c`id`',
    })
      .map((entry) => entry.command)
      .join('\n');
    expect(joined).toContain(`'https://github.com/a/$(touch /tmp/pwned).git'`);
    expect(joined).toContain("'c`id`'");
  });

  test('ports становятся серией -p, пустые — нулём флагов', () => {
    const run = plan()[3].command;
    expect(run).toContain(`-p '8080:80'`);
    expect(run).toContain(`-p '9000:443/tcp'`);
    // Проверять надо именно строку `docker run`: обёртка печатает `mkdir -p
    // '<logDir>'`, и ассерт по всей команде ловил бы её `-p` (замерено).
    const dockerRun = plan({ ports: [] })[3].command
      .split('\n')
      .find((line) => line.includes('docker run'));
    expect(dockerRun).toBeDefined();
    expect(dockerRun).not.toContain('-p');
  });

  test('dockerfile в подкаталоге меняет контекст сборки', () => {
    const build = plan({ dockerfile: 'docker/Dockerfile.prod' })[2].command;
    expect(build).toContain('--file ' + "'/opt/bios-deploy/proj-1/cfg-1/src/docker/Dockerfile.prod'");
    expect(build).toContain("'/opt/bios-deploy/proj-1/cfg-1/src/docker'");
  });

  test('не-ROOT: каждый шаг целиком идёт через sudo -n, ROOT — никогда', () => {
    for (const entry of plan({ root: false })) {
      expect(entry.command).toContain('sudo -n sh -lc');
      // двойного sudo внутри тела быть не должно
      expect(entry.command.match(/sudo/g)).toHaveLength(1);
    }
    for (const entry of plan({ root: true })) {
      expect(entry.command).not.toContain('sudo');
    }
  });

  test('шаги работают под одним деревом: paths корень + /src и /logs', () => {
    expect(PATHS.srcDir).toBe('/opt/bios-deploy/proj-1/cfg-1/src');
    expect(PATHS.logDir).toBe('/opt/bios-deploy/proj-1/cfg-1/logs');
  });
});

describe('parseStepResult', () => {
  const stdout = [
    'BIOS_RC=0',
    'BIOS_SHA=7fd1a60',
    'BIOS_STEP=source',
    'BIOS_LOG_BEGIN',
    'Cloning into',
    'BIOS_LOG_END',
  ].join('\n');

  test('читает rc, маркеры значений и лог', () => {
    expect(parseStepResult(stdout, '', 0)).toEqual({
      code: 0,
      markers: { RC: '0', SHA: '7fd1a60', STEP: 'source' },
      log: 'Cloning into',
      protocolOk: true,
    });
  });

  test('терпит trim от node-ssh и пустой лог', () => {
    const parsed = parseStepResult(
      `  ${stdout.replace('Cloning into', '')}  `,
      '',
      0,
    );
    expect(parsed.markers.SHA).toBe('7fd1a60');
    expect(parsed.log).toBe('');
  });

  test('нет конверта — protocolOk=false, а не успешный шаг', () => {
    const broken = parseStepResult('всё хорошо', '', 0);
    expect(broken.markers).toEqual({});
    expect(broken.protocolOk).toBe(false);
  });

  test('BEGIN без END — тоже сломанный конверт', () => {
    expect(
      parseStepResult('BIOS_RC=0\nBIOS_LOG_BEGIN\nобрезало', '', 0).protocolOk,
    ).toBe(false);
  });

  test('stderr добавляется к логу: docker пишет диагноз именно туда', () => {
    const parsed = parseStepResult(stdout, 'permission denied', 1);
    expect(parsed.log).toContain('permission denied');
  });

  test('вывод сборки не может подделать протокол (ревью №1)', () => {
    // `docker build` печатает в том числе текст Dockerfile; маркеры читаются
    // только из области до BIOS_LOG_BEGIN, поэтому эта строка — данные
    const spoofed = [
      'BIOS_STEP=build',
      'BIOS_RC=53',
      'BIOS_LOG_BEGIN',
      'BIOS_RC=0',
      'BIOS_SHA=deadbeef',
      'BIOS_CID=ffff',
      'BIOS_LOG_END',
    ].join('\n');
    const parsed = parseStepResult(spoofed, '', 53);
    expect(parsed.markers).toEqual({ STEP: 'build', RC: '53' });
    expect(parsed.log).toContain('BIOS_RC=0');
    expect(deployErrorCodeOf('build', parsed)).toBe('BUILD_FAILED');
  });
});

describe('deployErrorCodeOf', () => {
  const ok = (
    rc: number | null,
    step: DeployStepName,
    extra: Partial<StepResult> = {},
  ): StepResult => ({
    code: rc,
    markers: { ...(rc === null ? {} : { RC: String(rc) }), STEP: step },
    log: '',
    protocolOk: true,
    ...extra,
  });

  test('наши коды становятся диагнозами панели', () => {
    expect(deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.GIT, 'preflight'))).toBe('GIT_MISSING');
    expect(deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.DOCKER, 'preflight'))).toBe('DOCKER_MISSING');
    expect(deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.DOCKER_PERM, 'preflight'))).toBe('DOCKER_PERMISSION_DENIED');
    expect(deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.DOCKER_SOCKET, 'preflight'))).toBe('DOCKER_SOCKET_UNREACHABLE');
    expect(deployErrorCodeOf('source', ok(DEPLOY_EXIT_CODES.REF, 'source'))).toBe('REF_NOT_FOUND');
    expect(deployErrorCodeOf('build', ok(DEPLOY_EXIT_CODES.DOCKERFILE, 'build'))).toBe('DOCKERFILE_MISSING');
    expect(deployErrorCodeOf('source', ok(DEPLOY_EXIT_CODES.SOURCE, 'source', { log: 'fatal: repository not found' }))).toBe('SOURCE_FAILED');
    expect(deployErrorCodeOf('build', ok(1, 'build'))).toBe('BUILD_FAILED');
    expect(deployErrorCodeOf('run', ok(125, 'run'))).toBe('RUN_FAILED');
  });

  test('успех без подтверждения шагом — COMMAND_FAILED, с подтверждением — null', () => {
    expect(deployErrorCodeOf('run', ok(0, 'run', { markers: {} }))).toBe('COMMAND_FAILED');
    expect(deployErrorCodeOf('run', ok(0, 'run'))).toBeNull();
  });

  test('нет конверта или нет RC — COMMAND_FAILED, код соединения сам по себе не довод', () => {
    expect(deployErrorCodeOf('source', ok(0, 'source', { protocolOk: false }))).toBe('COMMAND_FAILED');
    expect(deployErrorCodeOf('source', ok(null, 'source'))).toBe('COMMAND_FAILED');
  });

  test('RC из конверта и код канала обязаны совпадать', () => {
    // обёртка делает `exit "$RC"`: расхождение значит, что конверт собран не ей
    expect(deployErrorCodeOf('build', ok(0, 'build', { code: 53 }))).toBe('COMMAND_FAILED');
    // code === null (шов не дал кода) при наличии RC — не противоречие, RC и так единственный источник
    expect(deployErrorCodeOf('build', ok(0, 'build', { code: null }))).toBeNull();
  });
});
describe('toDeploySnapshot', () => {
  const valid = {
    method: 'GIT_PULL',
    ref: 'master',
    dockerfile: 'Dockerfile',
    containerName: 'shop-web',
    ports: ['8080:80'],
    repoUrl: 'https://github.com/octocat/hello-world.git',
  };

  test('читает то, что записал enqueue', () => {
    expect(toDeploySnapshot(valid)).toEqual(valid);
    expect(toDeploySnapshot({ ...valid, ports: [] })?.ports).toEqual([]);
  });

  test('null на мусоре: исполнитель не имеет права исполнять наугад', () => {
    expect(toDeploySnapshot(null)).toBeNull();
    expect(toDeploySnapshot('master')).toBeNull();
    expect(toDeploySnapshot([])).toBeNull();
    expect(toDeploySnapshot({ ...valid, ports: '8080:80' })).toBeNull();
    expect(toDeploySnapshot({ ...valid, ports: [1] })).toBeNull();
    expect(toDeploySnapshot({ ...valid, method: 'COMPOSE' })).toBeNull();
    expect(toDeploySnapshot({ ...valid, repoUrl: undefined })).toBeNull();
  });
});

test('toPrismaStep: строчный протокол → enum БД', () => {
  expect(['preflight', 'source', 'build', 'run'].map(toPrismaStep)).toEqual([
    'PREFLIGHT',
    'SOURCE',
    'BUILD',
    'RUN',
  ]);
});
```

Run: `npx jest src/modules/deployments` → Expected: FAIL (`Cannot find module './deploy-script'`).

- [x] **Step 3: Реализовать билдер**

Create `src/modules/deployments/deploy-script.ts`:

```ts
import { priv, shq } from '../servers/agent/shell-quote';
import type { DeployErrorCode, DeployStepName } from './deployment.types';

export type { DeployStepName };

/**
 * Пути НА ХОСТЕ. Состоят из UUIDv7 проекта/конфигурации и корня из конфига;
 * пользовательских строк в путях нет, но `shq()` применяется всё равно:
 * инвариант «в shell уходит только экранированное» не должен зависеть от того,
 * что боевые значения аккуратные (правило части 3, agent-script.ts:97-100).
 */
export interface DeployPaths {
  root: string;
  srcDir: string;
  logDir: string;
}

export function deployPaths(
  rootDir: string,
  projectId: string,
  configId: string,
): DeployPaths {
  const root = `${rootDir}/${projectId}/${configId}`;
  return { root, srcDir: `${root}/src`, logDir: `${root}/logs` };
}

export interface StepCommand {
  step: DeployStepName;
  command: string;
}

export interface DeployPlanInput {
  paths: DeployPaths;
  root: boolean;
  repoUrl: string;
  ref: string;
  dockerfile: string;
  imageTag: string;
  containerName: string;
  ports: string[];
  logTailBytes: number;
}

/**
 * Коды наших preflight-проверок. 42/45/46 совпадают с buildInstallScript
 * (agent-script.ts:140-150): диагноз состояния хоста не должен разъезжаться
 * между «поставить агента» и «задеплоить».
 */
export const DEPLOY_EXIT_CODES = {
  DOCKER: 42,
  SYSTEMD: 43,
  DOCKER_PERM: 45,
  DOCKER_SOCKET: 46,
  GIT: 50,
  REF: 51,
  SOURCE: 52,
  BUILD: 53,
  RUN: 54,
  DOCKERFILE: 55,
} as const;

/**
 * Обёртка шага: полный вывод — в файл на хосте, в stdout — только хвост.
 * Причина измерена (п.7): node-ssh складывает все чанки в массив и склеивает в
 * конце, поэтому «большой лог» = RAM панели.
 *
 * Маркеры значений пишутся НЕ в stdout (он перехвачен в лог-файл), а в kv-файл,
 * который обёртка печатает в stdout уже после subshell.
 */
function step(
  name: DeployStepName,
  paths: DeployPaths,
  root: boolean,
  tailBytes: number,
  hostLogBytes: number,
  body: string[],
): StepCommand {
  const log = `${paths.logDir}/${name}.log`;
  const kv = `${paths.logDir}/${name}.kv`;
  const script = [
    'set -u',
    `mkdir -p ${shq(paths.logDir)}`,
    `: > ${shq(kv)}`,
    `kv() { printf '%s=%s\\n' "$1" "$2" >> ${shq(kv)}; }`,
    '( set -eu',
    ...body,
    `) > ${shq(log)} 2>&1`,
    'RC=$?',
    // Ограничиваем и файл на ХОСТЕ (ревью, блок «остальное»): без этого каждый
    // следующий деплой оставлял бы на диске клиента полный вывод сборки,
    // сколько бы та ни напечатала. Ограничение постфактум, а не в трубе: труба
    // вернула бы $? от tail, а не от шага. Пик во время шага этим не лечится —
    // см. Known gaps. stderr глушим: он идёт в тот же канал, что и конверт.
    `tail -c ${hostLogBytes} ${shq(log)} > ${shq(log + '.cap')} 2>/dev/null && mv -f ${shq(log + '.cap')} ${shq(log)} || true`,
    `printf 'BIOS_STEP=%s\\n' ${shq(name)}`,
    `printf 'BIOS_RC=%s\\n' "$RC"`,
    `cat ${shq(kv)} || true`,
    `printf 'BIOS_LOG_BEGIN\\n'`,
    `tail -c ${tailBytes} ${shq(log)} || true`,
    `printf '\\nBIOS_LOG_END\\n'`,
    'exit "$RC"',
  ].join('\n');
  return { step: name, command: priv(script, root) };
}
```

`root` передаётся в `priv()` целиком для обёртки, а не для отдельных команд: под `sudo -n sh -lc` попадают и `mkdir` корня, и запись логов, и `docker`, — иначе непривилегированный пользователь не смог бы написать ни в `/opt/bios-deploy`, ни в сокет докера. Внутри тела больше никакого `sudo` не появляется (двойной sudo — это лишняя проверка пароля, которой нет).

Тела шагов:

```ts
function preflightBody(paths: DeployPaths): string[] {
  return [
    `command -v git >/dev/null 2>&1 || { echo BIOS_ERR_GIT >&2; exit ${DEPLOY_EXIT_CODES.GIT}; }`,
    `command -v docker >/dev/null 2>&1 || { echo BIOS_ERR_DOCKER >&2; exit ${DEPLOY_EXIT_CODES.DOCKER}; }`,
    'docker info >/dev/null 2>&1 || {',
    '  err=$(docker info 2>&1 || true)',
    '  case "$err" in',
    `    *"permission denied"*) echo BIOS_ERR_DOCKER_PERM >&2; exit ${DEPLOY_EXIT_CODES.DOCKER_PERM} ;;`,
    `    *"Cannot connect to the Docker daemon"*) echo BIOS_ERR_DOCKER_SOCKET >&2; exit ${DEPLOY_EXIT_CODES.DOCKER_SOCKET} ;;`,
    `    *) echo BIOS_ERR_DOCKER >&2; exit ${DEPLOY_EXIT_CODES.DOCKER} ;;`,
    '  esac',
    '}',
    `mkdir -p ${shq(paths.root)}`,
  ];
}

function sourceBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  const url = shq(input.repoUrl);
  const ref = shq(input.ref);
  const dir = shq(paths.srcDir);
  const probe = shq(`${paths.logDir}/source.probe`);
  return [
    // Ревью №2: `git ls-remote … | grep -q .` без pipefail отдаёт статус `grep`,
    // и сетевой отказ (`ls-remote` упал) неотличим от отсутствующей ветки
    // (`ls-remote` работал, но выдал 0 строк). Замер: `sh -c 'ls /no-such-dir
    // 2>/dev/null | grep -q .; echo $?'` → 1. Поэтому код проверяется отдельно.
    `git ls-remote --heads --tags ${url} ${ref} > ${probe} 2>&1 || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    `[ -s ${probe} ] || { echo BIOS_ERR_REF >&2; exit ${DEPLOY_EXIT_CODES.REF}; }`,
    `if [ -d ${dir}/.git ]; then`,
    `  git -C ${dir} fetch --depth 1 origin ${ref} || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    `  git -C ${dir} reset --hard FETCH_HEAD || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    'else',
    `  git clone --depth 1 --branch ${ref} ${url} ${dir} || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    'fi',
    // Полный SHA, не `--short`: короткую форму выбирает UI для отображения, а
    // история должна хранить идентичность кода (ревью, блок «остальное»).
    `kv BIOS_SHA "$(git -C ${dir} rev-parse HEAD)"`,
  ];
}

function buildBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  const file = shq(`${paths.srcDir}/${input.dockerfile}`);
  const context = input.dockerfile.includes('/')
    ? shq(`${paths.srcDir}/${input.dockerfile.slice(0, input.dockerfile.lastIndexOf('/'))}`)
    : shq(paths.srcDir);
  return [
    `[ -f ${file} ] || { echo BIOS_ERR_DOCKERFILE >&2; exit ${DEPLOY_EXIT_CODES.DOCKERFILE}; }`,
    // `-q` даёт ровно одну строку — идентификатор образа (замер п.3).
    `IMG=$(docker build -q --file ${file} -t ${shq(input.imageTag)} ${context}) || { echo BIOS_ERR_BUILD >&2; exit ${DEPLOY_EXIT_CODES.BUILD}; }`,
    `kv BIOS_IMAGE "$IMG"`,
  ];
}

function runBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  void paths;
  const flags = input.ports.map((mapping) => `-p ${shq(mapping)}`).join(' ');
  const name = shq(input.containerName);
  return [
    // ПОРЯДОК ОСОЗНАННО РАЗРУШИТЕЛЬНЫЙ (ревью №6): старый контейнер снимается
    // до того, как новый подтверждён. Это MVP-схема «stop then start»: у панели
    // нет второго набора портов и прокси, чтобы поднять кандидата и переключить
    // трафик. Следствие — `RUN_FAILED` означает «старый сервис уже удалён», и
    // диагностику это надо показывать честно (см. Known gaps №8).
    // Замер (п.2): `docker rm -f` несуществующего контейнера возвращает 0;
    // `|| true` оставляем как защиту от расхождений CLI, а не от замеренного кода.
    `docker rm -f ${name} >/dev/null 2>&1 || true`,
    `CID=$(docker run -d --name ${name}${flags ? ` ${flags}` : ''} ${shq(input.imageTag)}) || { echo BIOS_ERR_RUN >&2; exit ${DEPLOY_EXIT_CODES.RUN}; }`,
    `kv BIOS_CID "$CID"`,
  ];
}

/** Ровно четыре шага. Исполнитель обязан идти по порядку и остановиться на первом неуспехе. */
export function buildDeployPlan(input: DeployPlanInput): StepCommand[] {
  return [
    step(
      'preflight',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      preflightBody(input.paths),
    ),
    step(
      'source',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      sourceBody(input.paths, input),
    ),
    step(
      'build',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      buildBody(input.paths, input),
    ),
    step(
      'run',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      runBody(input.paths, input),
    ),
  ];
}
```

`void paths;` в `runBody` — параметры остаются едиными для всех тел (`(paths, input)`), чтобы билдер читался как один список; если lint-конфиг разрешает неиспользуемый параметр, строку удалить (Step 4 это покажет).

Парсер и классификатор — там же в файле:

```ts
export interface StepResult {
  code: number | null;
  /** Ключи без префикса: `markers.RC`, `markers.SHA`, `markers.CID`. */
  markers: Record<string, string>;
  log: string;
  /** Есть и `BIOS_LOG_BEGIN`, и `BIOS_LOG_END`: вывод сформирован обёрткой. */
  protocolOk: boolean;
}

const MARKER_RE = /^BIOS_([A-Z]+)=(.*)$/;
const BEGIN = 'BIOS_LOG_BEGIN';
const END_MARK = 'BIOS_LOG_END';
const LOG_RE = /BIOS_LOG_BEGIN\n([\s\S]*?)\n?BIOS_LOG_END/;

/**
 * Маркеры читаются ТОЛЬКО из служебной области до `BIOS_LOG_BEGIN` (ревью №1).
 * Иначе вывод `docker build`, который печатает в том числе текст Dockerfile,
 * может содержать строку `BIOS_RC=0`, и парсер перезаписал бы настоящий код
 * шага — неуспешный шаг стал бы успешным, и исполнитель пошёл бы дальше.
 * Логи — данные, а не протокол: из `log` не извлекается ничего.
 */
export function parseStepResult(
  stdout: string,
  stderr: string,
  code: number | null,
): StepResult {
  const begin = stdout.indexOf(BEGIN);
  const end = stdout.indexOf(END_MARK);
  const protocolOk = begin !== -1 && end !== -1 && end > begin;
  const head = protocolOk ? stdout.slice(0, begin) : '';
  const markers: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const match = MARKER_RE.exec(line.trim());
    if (match) markers[match[1]] = match[2];
  }
  const logMatch = protocolOk ? LOG_RE.exec(stdout) : null;
  const tail = (logMatch?.[1] ?? '').trim();
  const err = stderr.trim();
  return {
    code,
    markers,
    log: [tail, err].filter((part) => part !== '').join('\n'),
    protocolOk,
  };
}

/**
 * Диагностика = (шаг, код, текст). Специфичные коды различают «git нет»,
 * «докер молчит», «ветки нет»; остальное маппится по шагу, потому что
 * `docker build` и `docker run` падают с кодами, которые CLI не систематизирует.
 *
 * Источник кода — маркер `BIOS_RC` из служебной области, но он обязан
 * соглашаться с кодом завершения SSH-канала: обёртка делает `exit "$RC"`,
 * поэтому расхождение означает, что конверт подделан или собран не обёрткой.
 */
export function deployErrorCodeOf(
  step: DeployStepName,
  result: StepResult,
): DeployErrorCode | null {
  if (!result.protocolOk) return 'COMMAND_FAILED';
  const raw = result.markers.RC;
  const rc = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(rc)) return 'COMMAND_FAILED';
  if (result.code !== null && result.code !== rc) return 'COMMAND_FAILED';
  const byExit: Record<number, DeployErrorCode> = {
    [DEPLOY_EXIT_CODES.GIT]: 'GIT_MISSING',
    [DEPLOY_EXIT_CODES.DOCKER]: 'DOCKER_MISSING',
    [DEPLOY_EXIT_CODES.DOCKER_PERM]: 'DOCKER_PERMISSION_DENIED',
    [DEPLOY_EXIT_CODES.DOCKER_SOCKET]: 'DOCKER_SOCKET_UNREACHABLE',
    [DEPLOY_EXIT_CODES.REF]: 'REF_NOT_FOUND',
    [DEPLOY_EXIT_CODES.SOURCE]: 'SOURCE_FAILED',
    [DEPLOY_EXIT_CODES.BUILD]: 'BUILD_FAILED',
    [DEPLOY_EXIT_CODES.RUN]: 'RUN_FAILED',
    [DEPLOY_EXIT_CODES.DOCKERFILE]: 'DOCKERFILE_MISSING',
  };
  const mapped = byExit[rc];
  if (mapped) return mapped;
  if (rc === 0) {
    // Нулевой код ничего не обещает (правило части 3, agent.service.ts:147):
    // доверяем только когда шаг подтвердил себя маркером.
    return result.markers.STEP === step ? null : 'COMMAND_FAILED';
  }
  if (step === 'build') return 'BUILD_FAILED';
  if (step === 'run') return 'RUN_FAILED';
  if (step === 'source') return 'SOURCE_FAILED';
  return 'COMMAND_FAILED';
}

export function toPrismaStep(
  step: DeployStepName,
): 'PREFLIGHT' | 'SOURCE' | 'BUILD' | 'RUN' {
  return step.toUpperCase() as 'PREFLIGHT' | 'SOURCE' | 'BUILD' | 'RUN';
}
```

- [x] **Step 4: Прогнать юниты**

Run: `npx jest src/modules/deployments` → Expected: все PASS. Если `parseStepResult` не находит маркеры — проверить порядок печати в `step()`: `BIOS_STEP`/`BIOS_RC`/kv идут **до** `BIOS_LOG_BEGIN`, иначе лог съест строку маркера.

- [x] **Step 5: Песочный тест в настоящем `/bin/sh`**

Create `src/modules/deployments/deploy-script.sandbox.spec.ts` — по образцу `agent-script.sandbox.spec.ts:1-40` (стабы бинарников в `PATH`, `mkdtempSync`, отсутствие файлов-маркеров пивна):

```ts
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDeployPlan,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  type DeployPlanInput,
  type StepResult,
} from './deploy-script';

const PWNED = '/tmp/bios-sandbox-pwned';
const PWNED2 = '/tmp/bios-sandbox-pwned2';

function stub(bin: string, name: string, body: string): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}`, { mode: 0o755 });
}

function runStep(
  command: string,
  bin: string,
  path = `${bin}:/usr/bin:/bin`,
): StepResult {
  // Код шага берётся ИЗ КОНВЕРТА (BIOS_RC), как это делает исполнитель: `mv -f`
  // и `tail` в обёртке выполняются после субшелла, и статус процесса-обёртки не
  // обязан совпадать с RC собранного шага.
  let stdout = '';
  try {
    stdout = execFileSync('/bin/sh', ['-c', command], {
      env: { ...process.env, PATH: path },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    stdout = typeof e.stdout === 'string' ? e.stdout : '';
    if (stdout === '') throw err; // команда умерла до того, как что-то напечатала
  }
  return parseStepResult(stdout, '', null);
}

function sandboxRoot(prefix: string): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  return { root, bin };
}

/**
 * PATH без системных каталогов: на этой машине `/usr/bin/git` существует
 * (замер п.14), поэтому «git отсутствует» невозможно сыграть просто отсутствием
 * стабы — надо отрезать PATH. Coreutils линкуем в стабовую папку, иначе обёртка
 * потеряет `mkdir`/`tail` и код 50 утонет в 127.
 */
function linkCoreutils(bin: string): string {
  for (const [name, target] of [
    ['mkdir', '/bin/mkdir'],
    ['cat', '/bin/cat'],
    ['mv', '/bin/mv'],
    ['tail', '/usr/bin/tail'],
  ] as const) {
    symlinkSync(target, join(bin, name));
  }
  return bin;
}

/**
 * Стаба git: `clone` обязан оставить то, что читатель плана ждёт от настоящего
 * clone — рабочий каталог с `.git` и Dockerfile внутри. Иначе шаг `build` падает
 * на DOCKERFILE_MISSING (замер п.14), и тест проверял бы не сборку, а отсутствие
 * файла.
 */
const GIT_STUB_CLONE = [
  'for a in "$@"; do case "$a" in */src)',
  '  mkdir -p "$a/.git"; printf "FROM scratch\\n" > "$a/Dockerfile" ;;',
  'esac; done',
].join('\n');

function input(root: string, overrides: Partial<DeployPlanInput> = {}): DeployPlanInput {
  return {
    paths: deployPaths(join(root, 'deploy'), 'p1', 'c1'),
    root: true,
    repoUrl: 'https://github.com/octocat/hello-world.git',
    ref: 'master',
    dockerfile: 'Dockerfile',
    imageTag: 'bios-deploy:01912345-6789-7abc-aef0-1234567890ff',
    containerName: 'shop-web',
    ports: ['8080:80'],
    logTailBytes: 4096,
    hostLogBytes: 65536,
    ...overrides,
  };
}

/** 40-символьный SHA: `rev-parse HEAD`, а не `--short` (ревью, «остальное»). */
const FULL_SHA = '7fd1a60c093f60005fe24929fe1dcf68e0a7e5a0';

describe('deploy plan in a real shell', () => {
  beforeEach(() => {
    rmSync(PWNED, { force: true });
    rmSync(PWNED2, { force: true });
  });

  afterAll(() => {
    rmSync(PWNED, { force: true });
    rmSync(PWNED2, { force: true });
  });

  test('успешный план: значения приехали, лог на хосте ограничен, в панели хвост', () => {
    const { root, bin } = sandboxRoot('bios-deploy-');
    stub(bin, 'git', [
      'if [ "$1" = "ls-remote" ]; then printf "abc123\\trefs/heads/master\\n"; exit 0; fi',
        GIT_STUB_CLONE,
      `if [ "$1" = "-C" ]; then printf "${FULL_SHA}\\n"; exit 0; fi`,
      'exit 0',
    ].join('\n'));
    stub(bin, 'docker', [
      'i=0; while [ $i -lt 20000 ]; do echo "layer line $i"; i=$((i+1)); done >&2',
      'printf "sha256:aaa111\\n"',
      'exit 0',
    ].join('\n'));
    const plan = buildDeployPlan(input(root));
    const results = plan.map((entry) => runStep(entry.command, bin));
    expect(results.map((r) => r.markers.RC)).toEqual(['0', '0', '0', '0']);
    expect(results.map((r) => deployErrorCodeOf(r.markers.STEP, r))).toEqual([null, null, null, null]);
    expect(results[1].markers.SHA).toBe(FULL_SHA);
    expect(results[1].markers.SHA).toHaveLength(40);
    expect(results[3].markers.CID).toBeTruthy();

    const logPath = join(root, 'deploy', 'p1', 'c1', 'logs', 'build.log');
    const host = readFileSync(logPath, 'utf8');
    // docker напечатал ~300 КБ; на хосте осталось не больше hostLogBytes
    expect(host.length).toBeLessThanOrEqual(65536);
    expect(host.length).toBeGreaterThan(60000);
    // а в панель приехал только logTailBytes
    expect(results[2].log.length).toBeLessThanOrEqual(4096);
    expect(existsSync(PWNED)).toBe(false);
  });

  test('значения с кавычками и подстановкой не исполняются ни на одном шаге', () => {
    const { root, bin } = sandboxRoot('bios-deploy-pwn-');
    stub(bin, 'git', 'exit 0\n');
    stub(bin, 'docker', 'exit 0\n');
    const plan = buildDeployPlan(
      input(root, {
        repoUrl: `https://x/$(touch ${PWNED}).git`,
        ref: 'main',
        containerName: 'c`touch ' + PWNED + '`',
      }),
    );
    plan.forEach((entry) => runStep(entry.command, bin));
    expect(existsSync(PWNED)).toBe(false);
    expect(existsSync(PWNED2)).toBe(false);
  });

  test('git отсутствует → preflight даёт RC=50 и диагностику GIT_MISSING', () => {
    const { root, bin } = sandboxRoot('bios-deploy-nogit-');
    stub(bin, 'docker', 'exit 0\n'); // git-стаба НЕТ
    linkCoreutils(bin);
    // PATH = только стабовая папка: с /usr/bin в PATH настоящая проверка
    // `command -v git` прошла бы успешно и тест стал бы ложно-зелёным.
    const first = runStep(buildDeployPlan(input(root))[0].command, bin, bin);
    expect(first.markers.RC).toBe('50');
    expect(deployErrorCodeOf('preflight', first)).toBe('GIT_MISSING');
  });

  test('ls-remote отработал пусто → RC=51 и REF_NOT_FOUND', () => {
    const { root, bin } = sandboxRoot('bios-deploy-ref-');
    stub(bin, 'git', 'exit 0\n');      // ничего не печатает = 0 строк, код 0
    stub(bin, 'docker', 'exit 0\n');
    const second = runStep(buildDeployPlan(input(root))[1].command, bin);
    expect(second.markers.RC).toBe('51');
    expect(deployErrorCodeOf('source', second)).toBe('REF_NOT_FOUND');
  });

  test('ls-remote упал (сеть/TLS) → RC=52 и SOURCE_FAILED, а не REF_NOT_FOUND', () => {
    // ревью №2: без pipefail конвейер с grep отдавал статус grep, и сетевой
    // отказ выглядел как «ветки нет». Замер: `sh -c 'ls /no-such | grep -q .;
    // echo $?'` → 1 в обоих случаях.
    const { root, bin } = sandboxRoot('bios-deploy-netfail-');
    stub(bin, 'git', 'if [ "$1" = "ls-remote" ]; then echo "fatal: unable to access" >&2; exit 128; fi\nexit 0\n');
    stub(bin, 'docker', 'exit 0\n');
    const second = runStep(buildDeployPlan(input(root))[1].command, bin);
    expect(second.markers.RC).toBe('52');
    expect(deployErrorCodeOf('source', second)).toBe('SOURCE_FAILED');
  });

  test('build падает → RC=53, BUILD_FAILED, шаг run не должен исполняться', () => {
    const { root, bin } = sandboxRoot('bios-deploy-build-');
    stub(
      bin,
      'git',
      [
        'if [ "$1" = "ls-remote" ]; then printf "x\\trefs/heads/master\\n"; exit 0; fi',
        GIT_STUB_CLONE,
        'exit 0',
      ].join('\n'),
    );
    stub(bin, 'docker', 'if [ "$1" = "info" ]; then exit 0; fi\nif [ "$1" = "rm" ]; then exit 0; fi\necho "error: dockerfile parse error" >&2\nexit 1\n');
    const plan = buildDeployPlan(input(root));
    const preflight = runStep(plan[0].command, bin);
    const source = runStep(plan[1].command, bin);
    const build = runStep(plan[2].command, bin);
    expect(preflight.markers.RC).toBe('0');
    expect(source.markers.RC).toBe('0');
    expect(deployErrorCodeOf('build', build)).toBe('BUILD_FAILED');
    expect(build.log).toContain('dockerfile parse error');
  });

  test('остановка на первом неуспехе — обязанность исполнителя, план её не делает', () => {
    const { root, bin } = sandboxRoot('bios-deploy-stop-');
    stub(bin, 'git', 'if [ "$1" = "ls-remote" ]; then exit 128; fi\nexit 0\n');
    stub(bin, 'docker', 'exit 0\n');
    const plan = buildDeployPlan(input(root));
    runStep(plan[0].command, bin);
    const source = runStep(plan[1].command, bin);
    const run = runStep(plan[3].command, bin);
    expect(source.markers.RC).toBe('52');
    // run-шаг сам по себе «успешен» (docker-стаб), и только исполнитель решает,
    // что до него дело не дойдёт.
    expect(run.markers.RC).toBe('0');
  });
});
```

Run: `npx jest src/modules/deployments` → Expected: PASS. Каждый стаб повторяет замеренное поведение: `ls-remote` с нулём строк (п.6), `docker build -q` с одной строкой sha (п.3), `docker rm -f` кодом 0 (п.2), git-отсутствие (п.1).

- [ ] **Step 6: Коммит**

```bash
cd app/backend && npx eslint src/modules/deployments && npx prettier --write "src/modules/deployments/**/*.ts" && npm run build
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/modules/deployments
git commit -m "feat(backend): four-step deploy plan with host-side log cap

Шаги печатают маркерный протокол (BIOS_RC/BIOS_STEP + значения из kv-файла) и
кладут полный вывод в файл на хосте, потому что node-ssh накапливает весь
stdout в памяти панели. Значения пишутся в kv-файл: stdout шага уже перехвачен
в лог, и напечатанный туда маркер парсер не увидел бы. Коды 42/45/46 совпадают
с install-скриптом части 3, чтобы диагноз состояния хоста не разъезжался.
"
```

---

## Task 6: `DeployRunnerService` — исполнитель: атомарный claim, четыре шага, журнал, reconcile

**Files:**
- Modify: `app/backend/src/modules/deployments/deploy-script.ts` (одна функция маппинга SSH-кода)
- Modify: `app/backend/src/modules/deployments/deploy-script.spec.ts`
- Modify: `app/backend/src/modules/servers/ssh/fake-ssh.runner.ts` (записывать `timeoutMs` каждого `exec`)
- Create: `app/backend/src/modules/deployments/deploy-runner.service.ts`
- Create: `app/backend/src/modules/deployments/deploy-runner.service.spec.ts`

**Interfaces:**
- Consumes: `SshRunner.exec` через `SSH_RUNNER` (часть 3), `ServersService.loadForSsh(userId, workspaceId, serverId, roles, purpose)` (`servers.service.ts:332`), `OWNER_ONLY_ROLES` (`servers.service.ts:41`), `buildDeployPlan`/`parseStepResult`/`deployErrorCodeOf`/`deployPaths`/`toPrismaStep` (Task 5), `toDeploySnapshot` (Task 5), `AppConfig['deploy']` c `maxParallel` и `hostLogBytes` (Task 2), `FailedDependencyException` (`common/http/failed-dependency.exception.ts`), модели `Deployment`/`DeployConfig`/`Project` (Task 1).
- Produces:

```ts
// deploy-script.ts
export function deployCodeOfSsh(code: SshErrorCode): DeployErrorCode;

// fake-ssh.runner.ts — двойник обязан различать дедлайны, иначе тест не может
// проверить, какой таймаут исполнитель повесил на шаг.
class FakeSshRunner {
  readonly execTimeoutMs: number[];            // push в exec, чистится в reset()
  exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult>;
}

// deploy-runner.service.ts
export type DeploymentJob = Prisma.DeploymentGetPayload<{
  include: { project: true; config: true };
}>;

@Injectable()
export class DeployRunnerService implements OnModuleInit {
  constructor(
    prisma: PrismaService,
    servers: ServersService,
    ssh: SshRunner,          // @Inject(SSH_RUNNER)
    cfg: AppConfig,          // @Inject(APP_CONFIG)
  );
  onModuleInit(): Promise<void>;               // reconcile, затем ничего не поднимаем сами
  reconcile(): Promise<number>;                // освобождает QUEUED/RUNNING, их число
  pump(): void;                                // поднять столько QUEUED, сколько свободных слотов
                                               // (повторный вызов во время хода — no-op)
  run(deploymentId: string): Promise<void>;    // один ожидаемый проход конкретной задачи
  drain(): Promise<void>;                      // дождать всего, что запущено этим процессом
}
```

Исполнитель **не** зависит от `DeploymentsService` — зависимость однонаправленная (Task 7 вызывает `start`), DI-цикла нет. `ProjectsService`/`DeployConfigsService` тоже не нужны: задача читается одним `include`, и `workspaceId` берётся из строки проекта, а не из пути запроса (у фоновой задачи пути нет).

Пять правил, на которых держится вся задача:

1. **Claim атомарен.** `updateMany({ where: { id, status: QUEUED } })` и проверка `count === 1` — единственная точка, после которой исполнитель считает себе принадлежащим право писать в эту строку. Два вызова `run()` на один id дают ровно один набор удалённых команд.
2. **Задача закрывается всегда.** Все ожидаемые отказы — исключение `DeployAbort` с готовым диагнозом; `execute()` обёрнут в `try/catch`, и любой выход из него (включая дефект самой панели) заканчивается `finalize`. `RUNNING` без `finishedAt` может означать только «процесс панели умер», и именно это читает `reconcile`.
3. **Слот конфигурации освобождается в finalize.** `activeConfigId: null` пишется на SUCCESS, FAILED и INTERRUPTED. Если забыть это на одной ветке, конфигурация заблокируется навсегда, и единственный способ разблокировать — правка в БД руками.
4. **Параллелимизм ограничен, и исполнитель сам решает, что начинать (ревью №11).** HTTP-маршрут не вызывает деплой по id — он зовёт `pump()`, а `pump` поднимает столько задач, сколько свободных слотов (`deploy.maxParallel`, по умолчанию 2), и берёт самую старую `QUEUED`. Иначе десять конфигураций одного воркспейса запускали бы десять параллельных `docker build` на десяти удалённых хостах из одного процесса панели: `sshOps` (6 запросов/мин) ограничивает частоту POST, но не число одновременно живых сборок.
5. **Исполнитель читает «что деплоить» из `snapshot`, а не из живых полей конфигурации (ревью №7).** Снимок written в момент постановки в очередь — единственный источник `repoUrl`, `ref`, `dockerfile`, `containerName`, `ports`; «куда» (`serverId`) берётся из живой связи, потому что сервер — это инфраструктура, а не параметры сборки (граница зафиксирована в Known gaps №10).

- [x] **Step 1: Падающий тест на маппинг SSH-кода** — закрыт в Task 5

`deployCodeOfSsh` импортируется уже `deploy-script.spec.ts` из Task 5, поэтому функция и три теста к ней переехали туда: иначе `tsc` падал бы между задачами. Здесь делать нечего.

```ts
describe('deployCodeOfSsh', () => {
  test('три кода шва имеют точный диагноз деплоя', () => {
    expect(deployCodeOfSsh('TIMEOUT')).toBe('TIMEOUT');
    expect(deployCodeOfSsh('HOST_KEY_NOT_TRUSTED')).toBe('HOST_KEY_NOT_TRUSTED');
    expect(deployCodeOfSsh('HOST_KEY_MISMATCH')).toBe('HOST_KEY_MISMATCH');
  });

  test('сетевые диагнозы различимы', () => {
    expect(deployCodeOfSsh('AUTH_FAILED')).toBe('AUTH_FAILED');
    expect(deployCodeOfSsh('REFUSED')).toBe('REFUSED');
    expect(deployCodeOfSsh('DNS')).toBe('DNS');
  });

  test('прочие детали транспорта сворачиваются в «хост недоступен»', () => {
    for (const code of ['NETWORK', 'RESOLUTION_FAILED', 'TARGET_BLOCKED',
      'PORT_NOT_ALLOWED', 'HOST_KEY', 'DOCKER_UNREACHABLE'] as const) {
      expect(deployCodeOfSsh(code)).toBe('HOST_UNREACHABLE');
    }
  });
});
```

Run: `npx jest src/modules/deployments/deploy-script` → Expected: FAIL (`deployCodeOfSsh is not a function`).

- [x] **Step 2: Реализовать маппинг и запись дедлайна в двойнике**

В конец `src/modules/deployments/deploy-script.ts` (импорт `type SshErrorCode` и `type DeployErrorCode` добавить к существующим):

```ts
/**
 * Что шов SSH говорит исполнителю деплоя. `exec` бросает только коды транспорта
 * (TIMEOUT, AUTH_FAILED, HOST_KEY_*), docker-коды сюда приходят из шагов, а не
 * отсюда, поэтому дефолт один: хост не доступен — деплой не начался.
 */
const SSH_TO_DEPLOY: Partial<Record<SshErrorCode, DeployErrorCode>> = {
  TIMEOUT: 'TIMEOUT',
  HOST_KEY_NOT_TRUSTED: 'HOST_KEY_NOT_TRUSTED',
  HOST_KEY_MISMATCH: 'HOST_KEY_MISMATCH',
  // Ревью, блок «остальное»: «хост не принимает наш ключ» и «до хоста не достучаться»
  // — разные действия оператора, и схлопывать их в один код нельзя.
  AUTH_FAILED: 'AUTH_FAILED',
  REFUSED: 'REFUSED',
  DNS: 'DNS',
};

export function deployCodeOfSsh(code: SshErrorCode): DeployErrorCode {
  return SSH_TO_DEPLOY[code] ?? 'HOST_UNREACHABLE';
}
```

В `src/modules/servers/ssh/fake-ssh.runner.ts` — поле рядом с `readonly transportDeadlineMs: number[]` (`fake-ssh.runner.ts:43`) и подпись `exec` с третьим параметром (`fake-ssh.runner.ts:79`):

```ts
  /** Дедлайны, которые исполнитель передал каждому exec-шагу. */
  readonly execTimeoutMs: number[] = [];

  exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult> {
    this.sessions.push(session);
    this.commands.push(command);
    this.execTimeoutMs.push(timeoutMs);
    …
```

Сигнатура интерфеса `SshRunner.exec` уже принимает `timeoutMs` (`ssh-runner.ts:76-80`), двойник его отбрасывал — поэтому тест не мог различить «дедлайн шага» и «дедлайн всей операции». `reset()` обязан очистить и этот массив (рядом с `transportDeadlineMs.length = 0`).

Run: `npx jest src/modules/deployments/deploy-script && npx jest src/modules/servers` → Expected: PASS (существующие тесты части 3/4 от третьего параметра не зависят).

- [x] **Step 3: Падающие тесты исполнителя**

Create `src/modules/deployments/deploy-runner.service.spec.ts`. Харнесс — реальный Prisma на `bios_test_deploy_runner` и `FakeSshRunner`, как в `servers.spec.ts:60-100`; конструкторы сервисов ручные, без Nest-обёртки. Прочитанное для ассертов берётся через `findUniqueOrThrow` (`servers.spec.ts:151`): `strictNullChecks: true` в `tsconfig.json:20`, и обычный `findUnique` заставил бы каждый ассерт писать `row!.log` или `expect(row).not.toBeNull()` — шум, который заглушает настоящий провал.

```ts
import { DeployMethod, Prisma, ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CredentialCryptoService } from '../servers/credentials/credential-crypto.service';
import { ServersService } from '../servers/servers.service';
import { FakeSshRunner } from '../servers/ssh/fake-ssh.runner';
import { SshFailure } from '../servers/ssh/ssh-runner';
import { testAppConfig } from '../../config/testing/app-config.fixture';
import { DeployRunnerService } from './deploy-runner.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy_runner?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const PIN = 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET = 'sup3rsecret';

function shqTest(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('waitFor: условие не наступило');
    await new Promise((r) => setImmediate(r));
  }
}

/** Хвост шага в том виде, в котором его печатает обёртка из Task 5. */
function stepOut(step: string, markers: string[] = [], log = 'ok'): string {
  return [
    `BIOS_STEP=${step}`,
    'BIOS_RC=0',
    ...markers,
    'BIOS_LOG_BEGIN',
    log,
    'BIOS_LOG_END',
  ].join('\n');
}

function failOut(step: string, rc: number, log: string): string {
  return [
    `BIOS_STEP=${step}`,
    `BIOS_RC=${rc}`,
    'BIOS_LOG_BEGIN',
    log,
    'BIOS_LOG_END',
  ].join('\n');
}

describe('DeployRunnerService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let servers: ServersService;
  let ssh: FakeSshRunner;
  let runner: DeployRunnerService;
  let ownerId: string;
  let workspaceId: string;
  let serverId: string;
  let projectId: string;
  let configId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ssh = new FakeSshRunner();
    const credentials = new CredentialCryptoService(testAppConfig());
    servers = new ServersService(
      prisma,
      workspaces,
      credentials,
      ssh,
      testAppConfig(),
    );
    runner = new DeployRunnerService(
      prisma,
      servers,
      ssh,
      testAppConfig({}, {}, { rootDir: '/tmp/bios-deploy' }),
    );
    ownerId = (
      await users.create({
        username: `drun${n}`,
        email: `drun${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `drun-ws-${n}` }))
      .id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-1',
        host: '203.0.113.21',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: credentials.encrypt(SECRET),
        hostKeyFingerprint: PIN,
      },
    });
    serverId = server.id;
    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: 'shop',
        repoUrl: 'https://github.com/octocat/hello-world.git',
      },
    });
    projectId = project.id;
    const config = await prisma.deployConfig.create({
      data: {
        projectId,
        serverId,
        name: 'prod',
        method: DeployMethod.GIT_PULL,
        ref: 'master',
        containerName: 'shop-web',
        ports: ['8080:80'],
      },
    });
    configId = config.id;
  });

  afterEach(async () => {
    await ssh.closeMock();
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  /**
   * Очередь наполняется напрямую через Prisma: `activeConfigId` — это контракт
   * схемы (Task 1), а способ его занять тестирует Task 7 своим набором тестов.
   */
  const snapshot = {
    method: 'GIT_PULL',
    ref: 'master',
    dockerfile: 'Dockerfile',
    containerName: 'shop-web',
    ports: ['8080:80'],
    repoUrl: 'https://github.com/octocat/hello-world.git',
  };

  async function enqueue(
    overrides: Partial<Prisma.DeploymentUncheckedCreateInput> = {},
  ) {
    return prisma.deployment.create({
      data: {
        projectId,
        configId,
        triggeredById: ownerId,
        activeConfigId: configId,
        snapshot,
        ...overrides,
      },
    });
  }

  /** Ещё одна конфигурация того же проекта: для теста очередей и параллелизма. */
  async function otherConfig(): Promise<string> {
    const row = await prisma.deployConfig.create({
      data: {
        projectId,
        serverId,
        name: 'staging',
        method: DeployMethod.GIT_PULL,
        ref: 'master',
        containerName: 'shop-staging',
      },
    });
    return row.id;
  }

  function scriptHappyPath(): void {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60'], 'Cloning into'));
    ssh.respond(/build\.log/, stepOut('build', ['BIOS_IMAGE=sha256:aaa111'], 'naming to docker.io'));
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=c0ffee1234'], 'c0ffee1234'));
  }

  test('успешный проход: четыре шага по порядку, SUCCESS и все значения из маркеров', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: 'SUCCESS',
      step: 'RUN',
      commitSha: '7fd1a60',
      imageTag: `bios-deploy:${job.id}`,
      containerId: 'c0ffee1234',
      errorCode: null,
      exitCode: null,
      activeConfigId: null,
    });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);

    // порядок шагов виден по именам лог-файлов в командах
    expect(ssh.commands).toHaveLength(4);
    expect(['preflight', 'source', 'build', 'run'].map((s) =>
      ssh.commands.findIndex((c) => c.includes(`${s}.log`)),
    )).toEqual([0, 1, 2, 3]);

    for (const step of ['preflight', 'source', 'build', 'run']) {
      expect(row.log.indexOf(`===== ${step} =====`)).toBeGreaterThan(-1);
    }
    expect(row.log.indexOf('===== source =====')).toBeLessThan(
      row.log.indexOf('===== build ====='),
    );
    expect(row.log).toContain('Cloning into');

    expect(ssh.probes).toHaveLength(0);
    expect(ssh.sessions).toHaveLength(4);
    // каждый шаг — аутентифицированная сессия с запиненным отпечатком
    expect(ssh.sessions.every((s) => s.expectedHostKeyFingerprint === PIN)).toBe(true);
    ssh.assertNoSecretLeak(SECRET);
  });

  test('дедлайн шага берётся из deploy.stepTimeoutMs, а не из ssh.commandTimeoutMs', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    // фикстура ставит 2000 там, где ssh.commandTimeoutMs = 1500: совпадение
    // значений сделало бы этот тест нечитаемым
    expect(ssh.execTimeoutMs).toEqual([2000, 2000, 2000, 2000]);
    expect(testAppConfig().ssh.commandTimeoutMs).not.toBe(2000);
  });

  test('claim атомарен: повторный и параллельный запуск дают один набор команд', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    expect(ssh.commands).toHaveLength(4);

    await runner.run(job.id);
    expect(ssh.commands).toHaveLength(4);

    const second = await enqueue();
    scriptHappyPath();
    await Promise.all([runner.run(job.id), runner.run(second.id)]);
    // 8 = два разных деплоя, а не две попытки одного
    expect(ssh.commands).toHaveLength(8);
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(2);
  });

  test('остановка на первом неуспехе: build RC=53 → шага run нет, диагноз с хвостом', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(/build\.log/, failOut('build', 53, 'error: dockerfile parse error'), {
      code: 53,
    });
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: 'FAILED',
      step: 'BUILD',
      errorCode: 'BUILD_FAILED',
      exitCode: 53,
      commitSha: '7fd1a60',
      containerId: null,
      activeConfigId: null,
    });
    expect(ssh.commands).toHaveLength(3);
    expect(row.log).toContain('dockerfile parse error');
  });

  test('git на хосте нет → preflight срывает деплой до source', async () => {
    ssh.respond(/preflight\.log/, failOut('preflight', 50, 'BIOS_ERR_GIT'), { code: 50 });
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'GIT_MISSING', exitCode: 50 });
    expect(ssh.commands).toHaveLength(1);
  });

  test('код 0 без подтверждения шагом — COMMAND_FAILED, а не SUCCESS', async () => {
    // FakeSshRunner отдаёт ПЕРВЫЙ неиспользованный ответ по регулярке, поэтому
    // «без протокола» надо ставить В ОЧЕРЕДЬ вместо build-ответа, а не после него.
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(/build\.log/, 'все хорошо, без всякого протокола');
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=c0ffee1234']));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'COMMAND_FAILED', step: 'BUILD' });
  });

  test('TIMEOUT шага → TIMEOUT, строка закрыта, слот освобождён', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.fail(/source\.log/, new SshFailure('TIMEOUT', 'ssh operation timed out'));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'TIMEOUT',
      activeConfigId: null,
    });
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  test('хост не принимает ключ → AUTH_FAILED на первом же шаге', async () => {
    ssh.fail(/preflight\.log/, new SshFailure('AUTH_FAILED', 'all authentication methods failed'));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'AUTH_FAILED', step: 'PREFLIGHT' });
  });

  test('порт закрыт → REFUSED, имя не разрешилось → DNS', async () => {
    for (const [code, expected] of [['REFUSED', 'REFUSED'], ['DNS', 'DNS']] as const) {
      ssh.reset();
      ssh.fail(/preflight\.log/, new SshFailure(code, 'transport'));
      const job = await enqueue();
      await runner.run(job.id);
      const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
      expect(row).toMatchObject({ status: 'FAILED', errorCode: expected });
    }
  });

  test('неизвестный сбой канала → HOST_UNREACHABLE, а не COMMAND_FAILED', async () => {
    ssh.fail(/preflight\.log/, new SshFailure('NETWORK', 'transport'));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'HOST_UNREACHABLE' });
  });

  test('host key не запинен → 424 из loadForSsh, ни одной удалённой команды', async () => {
    await prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: null },
    });
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'HOST_KEY_NOT_TRUSTED',
      step: null,
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('запустивший потерял доступ → ACCESS_LOST, ни одной удалённой команды', async () => {
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'ACCESS_LOST' });
    expect(ssh.commands).toHaveLength(0);
  });

  test('неожиданная ошибка в середине цикла закрывает задачу и сохраняет прогресс', async () => {
    // сценарий: панель упала внутри своего кода — на третьем шаге зарекаенного
    // ответа нет, FakeSshRunner бросает обычный Error
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'COMMAND_FAILED',
      commitSha: '7fd1a60',
      activeConfigId: null,
    });
  });

  test('reconcile: сироты становятся INTERRUPTED, а слот конфигурации освобождается', async () => {
    const started = new Date(Date.now() - 45000);
    const running = await enqueue({ status: 'RUNNING', startedAt: started, step: 'BUILD' });
    const queued = await enqueue({ activeConfigId: null, status: 'QUEUED' });
    // третья строка — уже завершённая: её трогать нельзя
    const done = await enqueue({ status: 'SUCCESS', finishedAt: new Date(), activeConfigId: null });

    expect(await runner.reconcile()).toBe(2);

    const r = await prisma.deployment.findUniqueOrThrow({ where: { id: running.id } });
    expect(r).toMatchObject({
      status: 'INTERRUPTED',
      errorCode: 'PANEL_RESTARTED',
      activeConfigId: null,
    });
    expect(r.durationMs).not.toBeNull();
    expect(r.durationMs).toBeGreaterThanOrEqual(45000);
    expect(r.log).toContain('INTERRUPTED');

    const q = await prisma.deployment.findUniqueOrThrow({ where: { id: queued.id } });
    // QUEUED не имел startedAt: длительность выдумывать нельзя
    expect(q).toMatchObject({ status: 'INTERRUPTED', durationMs: null });
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: done.id } }),
    ).toMatchObject({ status: 'SUCCESS' });

    // слот освобождён: следующая задача этой же конфигурации проходит по unique
    const next = await enqueue();
    expect(next.activeConfigId).toBe(configId);
  });

  test('план строится из snapshot, а не из живых полей конфигурации (ревью №7)', async () => {
    scriptHappyPath();
    const job = await enqueue();
    // «правка» конфигурации между постановкой в очередь и стартом
    await prisma.deployConfig.update({
      where: { id: job.configId },
      data: { ref: 'develop', containerName: 'renamed-web', ports: ['9090:80'] },
    });
    await runner.run(job.id);

    expect(ssh.commands).toHaveLength(4);
    const source = ssh.commands[1];
    expect(source).toContain(shqTest('master'));
    expect(source).not.toContain(shqTest('develop'));
    const run = ssh.commands[3];
    expect(run).toContain(shqTest('shop-web'));
    expect(run).not.toContain(shqTest('renamed-web'));
    expect(run).toContain(shqTest('8080:80'));
    expect(run).not.toContain(shqTest('9090:80'));
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: 'SUCCESS' });
  });

  test('снимок не читается → SNAPSHOT_INVALID до первой удалённой команды', async () => {
    scriptHappyPath();
    const job = await enqueue({ snapshot: { ref: 'master' } });
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'SNAPSHOT_INVALID' });
    expect(ssh.commands).toHaveLength(0);
  });

  test('поддельный BIOS_RC в хвосте лога не превращает провал в успех (ревью №1)', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(
      /source\.log/,
      stepOut('source', ['BIOS_SHA=' + 'a'.repeat(40)]),
    );
    // вывод docker build печатает в том числе текст Dockerfile: здесь в хвосте
    // лежит строка, похожая на успешный конверт
    ssh.respond(
      /build\.log/,
      'BIOS_STEP=build\nBIOS_RC=53\nBIOS_LOG_BEGIN\nBIOS_RC=0\nBIOS_STEP=build\nBIOS_LOG_END',
      { code: 53 },
    );
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=ffff']));
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'BUILD_FAILED', exitCode: 53 });
    // и до шага run дело не дошло
    expect(ssh.commands).toHaveLength(3);
  });

  test('maxParallel держит очередь: вторая задача не стартует, пока слот занят', async () => {
    // фикстура даёт maxParallel = 1; build-шаг первой задачи стоит на gate,
    // и мы видим промежуток, в котором вторая ОБЯЗАНА быть QUEUED
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = ssh.exec.bind(ssh);
    let builds = 0;
    ssh.exec = (session, command, timeoutMs) => {
      if (/build\.log/.test(command)) {
        builds += 1;
        return gate.then(() => inner(session, command, timeoutMs));
      }
      return inner(session, command, timeoutMs);
    };
    scriptHappyPath();
    scriptHappyPath();

    const first = await enqueue();
    const secondId = await otherConfig();
    const second = await enqueue({ configId: secondId, activeConfigId: secondId });

    runner.pump();
    await waitFor(() => builds > 0);

    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ status: 'RUNNING', step: 'BUILD' });
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({ status: 'QUEUED', step: null });

    release();
    await runner.drain();

    expect(builds).toBe(2);
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(2);
  });

  test('maxParallel = 2 поднимает обе конфигурации одновременно', async () => {
    runner = new DeployRunnerService(
      prisma,
      servers,
      ssh,
      testAppConfig({}, {}, { maxParallel: 2 }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = ssh.exec.bind(ssh);
    const gated: string[] = [];
    ssh.exec = (session, command, timeoutMs) => {
      if (!/build\.log/.test(command)) return inner(session, command, timeoutMs);
      gated.push(session.address);
      return gate.then(() => inner(session, command, timeoutMs));
    };
    scriptHappyPath();
    scriptHappyPath();
    const first = await enqueue();
    const other = await otherConfig();
    const second = await enqueue({ configId: other, activeConfigId: other });

    runner.pump();
    await waitFor(() => gated.length === 2);
    release();
    await runner.drain();

    expect(gated).toHaveLength(2);
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS', id: { in: [first.id, second.id] } } }),
    ).toBe(2);
  });

  test('pump() поднимает очередь сам и всё исполняется к drain()', async () => {
    scriptHappyPath();
    await enqueue();
    runner.pump();
    await runner.drain();
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(1);
  });
});
```

Run: `npx jest src/modules/deployments/deploy-runner` → Expected: FAIL (`Cannot find module './deploy-runner.service'`).

- [x] **Step 4: Реализовать исполнителя**

Create `src/modules/deployments/deploy-runner.service.ts`:

```ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  HttpException,
  Inject,
} from '@nestjs/common';
import { DeploymentStatus, Prisma } from '@prisma/client';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { OWNER_ONLY_ROLES, ServersService } from '../servers/servers.service';
import {
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshRunner,
  type SshSession,
} from '../servers/ssh/ssh-runner';
import {
  buildDeployPlan,
  deployCodeOfSsh,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  toPrismaStep,
} from './deploy-script';
import type { DeployErrorCode, DeployStepName } from './deployment.types';

export type DeploymentJob = Prisma.DeploymentGetPayload<{
  include: { project: true; config: true };
}>;

/**
 * Ожидаемый отказ исполнителя: диагноз уже известен, осталось закрыть строку.
 * `detail` пустой для проваленного шага — хвост лога уже в journal, второй раз
 * тот же текст в журнал класть не нужно.
 */
class DeployAbort extends Error {
  constructor(
    readonly errorCode: DeployErrorCode,
    readonly exitCode: number | null,
    readonly detail = '',
  ) {
    super(errorCode);
    this.name = 'DeployAbort';
  }
}

interface Journal {
  log: string;
  step: DeployStepName | null;
  commitSha: string | null;
  imageTag: string | null;
  containerId: string | null;
}

const ORPHAN_NOTE =
  '\n===== INTERRUPTED =====\nпанель перезапустилась; задача не продолжена и не перезапущена автоматически\n';

@Injectable()
export class DeployRunnerService implements OnModuleInit {
  private readonly logger = new Logger(DeployRunnerService.name);
  private readonly inflight = new Set<Promise<void>>();
  /** Ход движка, который идёт сейчас: нужен, чтобы `drain()` не бросил очередь
   *  на полуслове (pump резервирует слот не синхронно). */
  private ticking: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const released = await this.reconcile();
    if (released > 0) {
      this.logger.warn(
        `${released} deploy job(s) were left by the previous process and marked INTERRUPTED`,
      );
    }
  }

  /**
   * In-process исполнитель умирает вместе с панелью, и по продолжению работы
   * отличить «идёт» от «осиротело» нельзя: честный диагноз один — INTERRUPTED,
   * без автоперезапуска (решение владельца). Строка, простоявшая в очереди,
   * уходит в `INTERRUPTED` с `durationMs = null`: времени исполнения у неё не
   * было, и выдуманная длительность была бы хуже пустого поля.
   */
  async reconcile(): Promise<number> {
    const orphans = await this.prisma.deployment.findMany({
      where: {
        status: { in: [DeploymentStatus.QUEUED, DeploymentStatus.RUNNING] },
      },
      select: { id: true, startedAt: true, log: true },
    });
    for (const orphan of orphans) {
      const finishedAt = new Date();
      await this.prisma.deployment.update({
        where: { id: orphan.id },
        data: {
          status: DeploymentStatus.INTERRUPTED,
          errorCode: 'PANEL_RESTARTED',
          finishedAt,
          // без этого слот конфигурации остался бы занят навсегда
          activeConfigId: null,
          durationMs: orphan.startedAt
            ? finishedAt.getTime() - orphan.startedAt.getTime()
            : null,
          log: `${orphan.log}${ORPHAN_NOTE}`,
        },
      });
    }
    return orphans.length;
  }

  /**
   * Единственная точка, из которой HTTP-слой разрешает исполнение: поднять
   * столько `QUEUED`-задач, сколько свободных слотов (`deploy.maxParallel`),
   * начиная с самой старой. Не «запусти вот этот id»: очередь — состояние БД, а
   * не имя задачи, и параллельные POST не должны складывать N сборок в одном
   * процессе (ревью №11).
   */
  pump(): void {
    if (this.ticking) return;
    this.ticking = this.tick()
      .catch((err: unknown) => {
        this.logger.error(`deploy pump failed: ${String(err)}`);
      })
      .finally(() => {
        this.ticking = null;
      });
  }

  private async tick(): Promise<void> {
    while (this.inflight.size < this.cfg.deploy.maxParallel) {
      const [next] = await this.prisma.deployment.findMany({
        where: { status: DeploymentStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
        take: 1,
      });
      if (!next) return;
      const tracked = this.run(next.id)
        .catch((err: unknown) => {
          // run сам закрывает строку в БД; сюда долетает только собственный
          // дефект панели (например, упавший finalize)
          this.logger.error(`deploy ${next.id} escaped its own error handling`);
          this.logger.debug(String(err));
        })
        .finally(() => {
          this.inflight.delete(tracked);
          this.pump();
        });
      // Резерв слота синхронно после await: между проверкой размера и add нет
      // точки переключения, поэтому два tick не возьмут один и тот же слот.
      this.inflight.add(tracked);
    }
  }

  /** Дождаться всего, что запущено этим процессом (тесты, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.ticking || this.inflight.size > 0) {
      // `ticking` может породить новые `inflight`, а их finalize — новый ход
      // движка, поэтому один `Promise.allSettled` не был бы точкой покоя.
      await (this.ticking ?? Promise.allSettled([...this.inflight]));
    }
  }

  /**
   * Публичный ожидаемый проход: Claim → четыре шага → finalize. Обязан закрыть
   * строку на любом исходе, включая собственный дефект панели.
   */
  async run(deploymentId: string): Promise<void> {
    const startedAt = new Date();
    const claimed = await this.prisma.deployment.updateMany({
      where: { id: deploymentId, status: DeploymentStatus.QUEUED },
      data: { status: DeploymentStatus.RUNNING, startedAt },
    });
    if (claimed.count !== 1) return;

    const job = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true, config: true },
    });
    // Cascade-FK (Task 1) убирают проект/конфигурацию вместе с задачей, поэтому
    // отсутствие строки здесь — только гонка удаления между claim и чтением.
    if (!job) return;

    const journal: Journal = {
      log: job.log,
      step: null,
      commitSha: job.commitSha,
      imageTag: job.imageTag,
      containerId: job.containerId,
    };

    try {
      await this.execute(job, journal);
      await this.finalize(job, startedAt, journal, {
        status: DeploymentStatus.SUCCESS,
        errorCode: null,
        exitCode: null,
      });
    } catch (err) {
      const abort = err instanceof DeployAbort ? err : null;
      journal.log += abort ? abort.detail : `\n${this.text(err)}`;
      await this.finalize(job, startedAt, journal, {
        status: DeploymentStatus.FAILED,
        errorCode: abort ? abort.errorCode : this.unexpectedCode(err),
        exitCode: abort ? abort.exitCode : null,
      });
    }
  }

  private async execute(job: DeploymentJob, journal: Journal): Promise<void> {
    const imageTag = `bios-deploy:${job.id}`;

    // «Что деплоить» — из снимка, сделанного при постановке в очередь (ревью №7).
    // Живая конфигурация к моменту старта могла измениться; обещание пользователя
    // уже дано, и исполнять надо его.
    const snapshot = toDeploySnapshot(job.snapshot);
    if (snapshot === null) {
      throw new DeployAbort('SNAPSHOT_INVALID', null, '\nsnapshot unreadable');
    }

    let session: SshSession;
    let root: boolean;
    try {
      const loaded = await this.servers.loadForSsh(
        job.triggeredById,
        job.project.workspaceId,
        job.config.serverId,
        OWNER_ONLY_ROLES,
        'authenticated',
      );
      session = loaded.session;
      // то же правило, что у установки агента (agent.service.ts): root не требует sudo
      root = loaded.server.sshUsername === 'root';
    } catch (err) {
      // ни одной удалённой команды не отправлено; текст 424 — единственная
      // зацепка в журнале, поэтому он уходит в detail
      throw new DeployAbort(this.accessCode(err), null, `\n${this.text(err)}`);
    }

    const plan = buildDeployPlan({
      paths: deployPaths(this.cfg.deploy.rootDir, job.projectId, job.configId),
      root,
      repoUrl: snapshot.repoUrl,
      ref: snapshot.ref,
      dockerfile: snapshot.dockerfile,
      imageTag,
      containerName: snapshot.containerName,
      ports: snapshot.ports,
      logTailBytes: this.cfg.deploy.logTailBytes,
      hostLogBytes: this.cfg.deploy.hostLogBytes,
    });

    for (const entry of plan) {
      journal.step = entry.step;
      // Шаг пишется ДО его исполнения: `GET /deployments/:id` во время минутной
      // сборки должен показывать `build`, а не последний завершённый шаг.
      // Значения (SHA/CID) по-прежнему пишутся только с подтверждённого шага.
      await this.prisma.deployment.update({
        where: { id: job.id },
        data: { step: toPrismaStep(entry.step) },
      });
      let stdout = '';
      let stderr = '';
      let code: number | null = null;
      try {
        const res = await this.ssh.exec(
          session,
          entry.command,
          this.cfg.deploy.stepTimeoutMs,
        );
        stdout = res.stdout;
        stderr = res.stderr;
        code = res.code;
      } catch (err) {
        // node-ssh.runner обязан оборачивать любой сбой в SshFailure
        // (node-ssh.runner.ts:96-100), поэтому сырая ошибка от шва — дефект
        // панели, а не хоста: врать про недоступный хост она не имеет права.
        const errorCode =
          err instanceof SshFailure ? deployCodeOfSsh(err.code) : 'COMMAND_FAILED';
        throw new DeployAbort(errorCode, null, `\n${entry.step}: ${this.text(err)}`);
      }

      const result = parseStepResult(stdout, stderr, code);
      journal.log += `\n===== ${entry.step} =====\n${result.log}`;

      const errorCode = deployErrorCodeOf(entry.step, result);
      if (errorCode !== null) {
        // хвост шага уже в journal — второй раз его класть некуда и незачем
        throw new DeployAbort(errorCode, result.code);
      }

      // Значения пишутся только с подтверждённого шага: маркер SHA у source,
      // CID у run, а imageTag — тег, который мы сами попросили docker проставить.
      if (entry.step === 'source') journal.commitSha = result.markers.SHA ?? null;
      if (entry.step === 'build') journal.imageTag = imageTag;
      if (entry.step === 'run') journal.containerId = result.markers.CID ?? null;
      await this.progress(job.id, journal);
    }
  }

  /**
   * Прогресс пишется после каждого шага: `GET /deployments/:id` должен
   * показывать живую картину, а не только финал.
   */
  private async progress(deploymentId: string, journal: Journal): Promise<void> {
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        step: journal.step ? toPrismaStep(journal.step) : undefined,
        log: journal.log,
        commitSha: journal.commitSha,
        imageTag: journal.imageTag,
        containerId: journal.containerId,
      },
    });
  }

  private async finalize(
    job: DeploymentJob,
    startedAt: Date,
    journal: Journal,
    outcome: {
      status: DeploymentStatus;
      errorCode: DeployErrorCode | null;
      exitCode: number | null;
    },
  ): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.deployment.update({
      where: { id: job.id },
      data: {
        status: outcome.status,
        step: journal.step ? toPrismaStep(journal.step) : undefined,
        log: journal.log,
        commitSha: journal.commitSha,
        imageTag: journal.imageTag,
        containerId: journal.containerId,
        errorCode: outcome.errorCode,
        exitCode: outcome.exitCode,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        activeConfigId: null,
      },
    });
  }

  /**
   * Отказ до первой удалённой команды. `loadForSsh` говорит на языке HTTP:
   * 424 с кодом SSH — это диагноз хоста, 403/404 — потерянный доступ,
   * всё остальное (например, нечитаемый секрет) — дефект панели, а не деплоя.
   */
  private accessCode(err: unknown): DeployErrorCode {
    if (err instanceof FailedDependencyException) {
      const body = err.getResponse() as { errorCode?: SshErrorCode };
      return deployCodeOfSsh(body.errorCode ?? 'HOST_KEY_NOT_TRUSTED');
    }
    if (err instanceof SshFailure) return deployCodeOfSsh(err.code);
    if (err instanceof HttpException) {
      const status = err.getStatus();
      if (status === 403 || status === 404 || status === 401) return 'ACCESS_LOST';
    }
    return 'COMMAND_FAILED';
  }

  private unexpectedCode(err: unknown): DeployErrorCode {
    if (err instanceof SshFailure) return deployCodeOfSsh(err.code);
    return 'COMMAND_FAILED';
  }

  private text(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
```

Пять замечаний по этому коду — проверить глазами, а не на вкус:

1. Шов берётся из DI-токена `SSH_RUNNER`, а не из `ServersService`: исполнитель вызывает `exec` напрямую — ровно как `AgentService.execOr424` (`agent.service.ts:270`). `DockerService` части 4 использует `dockerTransport`, а `exec` — это другой метод того же интерфейса, и деплой идёт именно им.
2. `DeployAbort` приватен для файла: наружу не выходит — вовне только закрытая строка в БД.
3. `parseStepResult` вызывается и при `code !== 0` тоже: диагноз (`BUILD_FAILED` против `COMMAND_FAILED`) берётся из маркеров, а не из кода соединения.
4. `BIOS_IMAGE` исполнитель не читает. Маркер нужен песочному тесту Task 5 как самоподтверждение сборки, а handle для перезапуска — тег `bios-deploy:<id деплоя>`: он известен до первого `exec`, unique по построению и сортируется по времени, потому что id — UUIDv7.
5. `HttpException` в импортах нужен для `accessCode`; `Catch`/`Optional` в списке быть не должно.

- [x] **Step 5: Прогнать и проверить сборку**

```bash
cd app/backend && npx jest src/modules/deployments && npx tsc --noEmit -p tsconfig.json && npm run build && npx eslint src/modules/deployments
```

Expected: 20 тестов `deploy-runner.service.spec.ts` PASS, три новых теста маппинга в `deploy-script.spec.ts` PASS, юниты и песочница Task 5 — зелёные, `src/modules/servers` (части 3/4) — зелёны, tsc/eslint без замечаний. Если линт ругнётся на неиспользуемый импорт — удалить его, правило не отключать.

Типы, которые стоит проверить глазами после `prisma generate`: `journal.step` — строчный `'preflight' | …`, а в `data.step` уходит `toPrismaStep(...)`, то есть `PREFLIGHT | …`; Prisma принимает строковые литералы enum'а, каст не нужен.

- [ ] **Step 6: Коммит**

```bash
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/modules/deployments
git commit -m "feat(backend): in-process deploy runner with atomic claim and reconcile

Claim = updateMany по status QUEUED с проверкой count: два исполнителя на одной
строке не встречаются, и это держится одним запросом, а не чтением-и-записью.
Все ожидаемые отказы идут через DeployAbort, поэтому finalize один на все выходы:
задача не может остаться RUNNING без finishedAt, а слот конфигурации (уникальный
activeConfigId) освобождается на SUCCESS, FAILED и INTERRUPTED. Прогресс пишется
после каждого шага, чтобы GET /deployments/:id показывал живую картину.
reconcile при старте процесса не перезапускает чужие задачи — решение владельца.
"
```

---

## Task 7: `DeploymentsService` — очередь, история, детали и логи + маршруты 6–9

**Files:**
- Create: `app/backend/src/modules/deployments/dto/create-deployment.dto.ts`
- Create: `app/backend/src/modules/deployments/dto/deployment-ids.dto.ts`
- Create: `app/backend/src/modules/deployments/dto/list-deployments-query.dto.ts`
- Modify: `app/backend/src/modules/deployments/deployments.service.ts` (сейчас 4 строки)
- Modify: `app/backend/src/modules/deployments/deployments.controller.ts` (сейчас 7 строк, `@Controller()` без префикса)
- Modify: `app/backend/src/modules/deployments/deployments.module.ts`
- Create: `app/backend/src/modules/deployments/deployments.service.spec.ts`

**Interfaces:**
- Consumes: `ProjectsService.requireRow(projectId, workspaceId)` (Task 3), `DeployConfigsService.requireRow(configId, projectId)` (Task 4), `WorkspacesService.requireMembership` (`workspaces.service.ts:116-130`), `DeployRunnerService.pump()` (Task 6), `OWNER_ONLY_ROLES`/`MEMBER_ROLES`, `DeploymentResponse`/`DeploymentLogsResponse`/`DeployStepName`/`DeployErrorCode` (Task 5), `WorkspaceIdDto` (`workspaces/dto/workspace-id.dto.ts`), `ThrottleProfile('sshOps')`.
- Produces:

```ts
// dto/create-deployment.dto.ts
export class CreateDeploymentDto { projectId: string; configId: string; }
// dto/deployment-ids.dto.ts
export class DeploymentIdsDto { deploymentId: string; }
// dto/list-deployments-query.dto.ts
export class ListDeploymentsQueryDto { projectId?: string; configId?: string; limit?: string; }

// deployments.service.ts
@Injectable()
export class DeploymentsService {
  constructor(prisma, workspaces, projects, configs, runner: DeployRunnerService);
  create(userId, workspaceId, dto: CreateDeploymentDto): Promise<DeploymentResponse>;   // 202, QUEUED
  findAll(userId, workspaceId, query: ListDeploymentsQueryDto): Promise<DeploymentResponse[]>;
  findOne(userId, deploymentId): Promise<DeploymentResponse>;
  logs(userId, deploymentId): Promise<DeploymentLogsResponse>;
}

// deployments.controller.ts — ДВА контроллера в одном файле
@Controller('workspaces/:workspaceId/deployments') class DeploymentsController {}
@Controller('deployments')                           class DeploymentController {}
```

Три решения, которые здесь фиксируются:

1. **`POST /deployments` не ходит на хост.** Он вставляет `QUEUED`-строку, будит очередь (`runner.pump()`) и возвращает 202. `pump`, а не `start(id)`: слотов может быть занято несколько, и выбор «какую задачу начать» принадлежит исполнителю (ревью №11). Проверка доступности сервера, пина host key и роли belongs исполнителю (`loadForSsh` в Task 6) — иначе HTTP-запрос зависал бы на KEX, а метрика «первый деплой < 10 мин» считалась бы от ответа API, а не от результата на хосте.
2. **Слот конфигурации занимает вставка, а не исполнитель.** `activeConfigId: configId` пишется в том же `create`, что и вся задача: `@@unique` на этом поле и есть очередь «не более одной активной задачи на конфигурацию». P2002 превращается в 409 — без `SELECT … FOR UPDATE`, без «прочитал-и-записал».
3. **Плоский `GET /deployments/:id` отдаёт 404 и на чужую задачу.** Область видимости здесь не в пути, поэтому проверка строится «строка → её воркспейс → участница ли», а 403 от `requireMembership` намеренно гасится в 404: 403 подтвердил бы существование чужой задачи.

- [x] **Step 1: DTO**

Create `src/modules/deployments/dto/create-deployment.dto.ts`:

```ts
import { IsUUID } from 'class-validator';

/**
 * `workspaceId` в теле нет и быть не может: область видимости берётся только из
 * пути, иначе запрос мог бы задеплоить в чужой воркспейс «по просьбе» тела.
 */
export class CreateDeploymentDto {
  @IsUUID('7')
  projectId: string;

  @IsUUID('7')
  configId: string;
}
```

Create `src/modules/deployments/dto/deployment-ids.dto.ts`:

```ts
import { IsUUID } from 'class-validator';

/** Плоский маршрут `deployments/:deploymentId` — воркспейса в пути нет. */
export class DeploymentIdsDto {
  @IsUUID('7')
  deploymentId: string;
}
```

Create `src/modules/deployments/dto/list-deployments-query.dto.ts`:

```ts
import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * `limit` — строка с цифрами, а не число: `@Query()` приходит из URL строкой, а
 * приведение через `@Type` превратило бы `?limit=abc` в NaN и 500 вместо 400.
 * Тот же приём, что в `docker/dto/containers-query.dto.ts:6-12`.
 */
export class ListDeploymentsQueryDto {
  @IsOptional()
  @IsUUID('7')
  projectId?: string;

  @IsOptional()
  @IsUUID('7')
  configId?: string;

  @IsOptional()
  @Matches(/^(?:[1-9]\d?|100)$/, {
    message: 'limit must be an integer between 1 and 100',
  })
  limit?: string;
}
```

Run: `npx tsc --noEmit -p tsconfig.json` → Expected: пусто (файлы существуют, но на них никто не ссылается — это нормально для шага без тестов).

- [x] **Step 2: Падающие тесты сервиса**

Create `src/modules/deployments/deployments.service.spec.ts` — харнесс как в Task 6, но своя база `bios_test_deployments` (`beforeEach` с пользователем/воркспейсом/сервером/проектом/конфигурацией), исполнитель — шпион:

```ts
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeployMethod, ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CredentialCryptoService } from '../servers/credentials/credential-crypto.service';
import { ServersService } from '../servers/servers.service';
import { FakeSshRunner } from '../servers/ssh/fake-ssh.runner';
import { testAppConfig } from '../../config/testing/app-config.fixture';
import { ProjectsService } from '../projects/projects.service';
import { DeployConfigsService } from '../projects/deploy-configs.service';
import { DeployRunnerService } from './deploy-runner.service';
import { DeploymentsService } from './deployments.service';
import type { CreateDeploymentDto } from './dto/create-deployment.dto';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deployments?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const SECRET = 'sup3rsecret';

describe('DeploymentsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
  let configs: DeployConfigsService;
  let ssh: FakeSshRunner;
  let pumps: number;
  let deployments: DeploymentsService;
  let ownerId: string;
  let workspaceId: string;
  let projectId: string;
  let configId: string;
  let otherConfigId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    pumps = 0;
    ssh = new FakeSshRunner();
    const credentials = new CredentialCryptoService(testAppConfig());
    const servers = new ServersService(
      prisma,
      workspaces,
      credentials,
      ssh,
      testAppConfig(),
    );
    projects = new ProjectsService(prisma, workspaces);
    configs = new DeployConfigsService(prisma, workspaces, projects);
    // Исполнитель подменяется шпионом: Task 6 отвечает за то, как он исполняет,
    // здесь важен только контракт «постановка в очередь будит pump ровно один раз».
    const runner = {
      pump: () => {
        pumps += 1;
      },
    } as unknown as DeployRunnerService;
    deployments = new DeploymentsService(
      prisma,
      workspaces,
      projects,
      configs,
      runner,
    );

    ownerId = (
      await users.create({
        username: `dsvc${n}`,
        email: `dsvc${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `dsvc-ws-${n}` }))
      .id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-1',
        host: '203.0.113.22',
        port: 22,
        sshUsername: 'root',
        authType: ServerAuthType.PASSWORD,
        secretCipher: credentials.encrypt(SECRET),
        hostKeyFingerprint: 'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    const project = await projects.create(ownerId, workspaceId, {
      name: 'shop',
      repoUrl: 'https://github.com/octocat/hello-world.git',
    });
    projectId = project.id;
    configId = (
      await configs.create(ownerId, workspaceId, projectId, {
        name: 'prod',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'shop-web',
        serverId: server.id,
      })
    ).id;
    otherConfigId = (
      await configs.create(ownerId, workspaceId, projectId, {
        name: 'staging',
        method: 'GIT_PULL',
        ref: 'develop',
        containerName: 'shop-staging',
        serverId: server.id,
      })
    ).id;
  });

  afterEach(async () => {
    await ssh.closeMock();
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(overrides: Partial<CreateDeploymentDto> = {}): CreateDeploymentDto {
    return { projectId, configId, ...overrides };
  }

  test('create: QUEUED, слот занят, снимок на месте, очередь разбужена ровно раз', async () => {
    const res = await deployments.create(ownerId, workspaceId, dto());

    expect(res).toMatchObject({
      projectId,
      configId,
      status: 'QUEUED',
      step: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      triggeredById: ownerId,
      errorCode: null,
      imageTag: null,
    });
    expect(pumps).toBe(1);

    const row = await prisma.deployment.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.activeConfigId).toBe(configId);
    expect(row.snapshot).toMatchObject({
      ref: 'master',
      containerName: 'shop-web',
      ports: [],
      method: 'GIT_PULL',
      repoUrl: 'https://github.com/octocat/hello-world.git',
    });
  });

  test('create: активная задача этой же конфигурации — 409, новой строки нет, исполнитель молчит', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    pumps = 0;

    await expect(
      deployments.create(ownerId, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.deployment.count()).toBe(1);
    // отказ на вставке очередь не будит
    expect(pumps).toBe(0);
  });

  test('после завершения слот свободен: вторая задача той же конфигурации проходит', async () => {
    const first = await deployments.create(ownerId, workspaceId, dto());
    await prisma.deployment.update({
      where: { id: first.id },
      data: { status: 'SUCCESS', activeConfigId: null },
    });
    const second = await deployments.create(ownerId, workspaceId, dto());
    expect(second.status).toBe('QUEUED');
    expect(second.id).not.toBe(first.id);
  });

  test('разные конфигурации одного проекта не спорят за слот', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    const other = await deployments.create(
      ownerId,
      workspaceId,
      dto({ configId: otherConfigId }),
    );
    expect(other.configId).toBe(otherConfigId);
    expect(pumps).toBe(2);
  });

  test('create: чужой проект — 404, конфигурация из другого проекта — 404, MEMBER — 403', async () => {
    const otherWs = await workspaces.create(ownerId, { name: 'ds-other' });
    const foreignProject = await projects.create(ownerId, otherWs.id, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await expect(
      deployments.create(ownerId, workspaceId, dto({ projectId: foreignProject.id })),
    ).rejects.toBeInstanceOf(NotFoundException);

    const otherProject = await projects.create(ownerId, workspaceId, {
      name: 'other',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await expect(
      deployments.create(ownerId, workspaceId, dto({ projectId: otherProject.id })),
    ).rejects.toBeInstanceOf(NotFoundException);
    // configId принадлежит projectId, а не otherProject — это тот же 404
    await expect(
      deployments.create(ownerId, workspaceId, {
        projectId: otherProject.id,
        configId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const memberId = (
      await users.create({
        username: `dsmem${n}`,
        email: `dsmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId, role: 'MEMBER' },
    });
    await expect(
      deployments.create(memberId, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pumps).toBe(0);
  });

  test('list: свежие первыми, фильтры по проекту и конфигурации, limit применяется', async () => {
    const a = await deployments.create(ownerId, workspaceId, dto({ configId }));
    await prisma.deployment.update({
      where: { id: a.id },
      data: { status: 'SUCCESS', activeConfigId: null },
    });
    const b = await deployments.create(ownerId, workspaceId, dto({ configId: otherConfigId }));

    const all = await deployments.findAll(ownerId, workspaceId, {});
    expect(all.map((row) => row.id)).toEqual([b.id, a.id]);
    expect(
      await deployments.findAll(ownerId, workspaceId, { configId: otherConfigId }),
    ).toEqual([expect.objectContaining({ id: b.id })]);
    expect(
      await deployments.findAll(ownerId, workspaceId, { projectId: 'nope' }),
    ).toEqual([]);
    expect(await deployments.findAll(ownerId, workspaceId, { limit: '1' })).toHaveLength(1);
    expect(await deployments.findAll(ownerId, workspaceId, { limit: '999' })).toHaveLength(2);
  });

  test('list: не участник воркспейса — 404, как везде в панели', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    const stranger = (
      await users.create({
        username: `dsstr${n}`,
        email: `dsstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    // Не 403: `requireMembership` бросает NotFoundException, когда строки членства
    // нет (workspaces.service.ts:152), и части 3/4 живут по этому правилу — чужой
    // воркспейс неотличим от несуществующего. 403 получает УЧАСТНИК с ролью MEMBER.
    await expect(
      deployments.findAll(stranger, workspaceId, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('findOne и logs: участник видит свою задачу, чужак получает 404 на оба', async () => {
    const created = await deployments.create(ownerId, workspaceId, dto());
    await prisma.deployment.update({
      where: { id: created.id },
      data: { status: 'RUNNING', step: 'BUILD', log: '\n===== build =====\nnaming to image' },
    });

    expect(await deployments.findOne(ownerId, created.id)).toMatchObject({
      id: created.id,
      status: 'RUNNING',
      step: 'build',
    });
    expect(await deployments.logs(ownerId, created.id)).toEqual({
      deploymentId: created.id,
      status: 'RUNNING',
      finished: false,
      log: '\n===== build =====\nnaming to image',
      sizeBytes: Buffer.byteLength('\n===== build =====\nnaming to image', 'utf8'),
    });

    const otherWs = await workspaces.create(ownerId, { name: 'ds-other2' });
    const stranger = (
      await users.create({
        username: `dstr${n}`,
        email: `dstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    // участник другого воркспейса: задача существует, но 403 запрещает даже
    // подтвердить это — наружу уходит 404
    expect(otherWs.id).not.toBe(workspaceId);
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: stranger, role: 'MEMBER' },
    });
    await expect(deployments.findOne(stranger, created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(deployments.logs(stranger, created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      deployments.findOne(ownerId, '01912345-6789-7abc-aef0-1234567890ff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('logs: завершённые статусы дают finished=true, QUEUED — false', async () => {
    const created = await deployments.create(ownerId, workspaceId, dto());
    for (const status of ['SUCCESS', 'FAILED', 'INTERRUPTED'] as const) {
      await prisma.deployment.update({
        where: { id: created.id },
        data: { status, activeConfigId: null },
      });
      expect((await deployments.logs(ownerId, created.id)).finished).toBe(true);
    }
    await prisma.deployment.update({
      where: { id: created.id },
      data: { status: 'QUEUED', activeConfigId: configId },
    });
    expect((await deployments.logs(ownerId, created.id)).finished).toBe(false);
  });

  test('ответ — ровно контракт: ни cipher, ни snapshot, ни чужих полей БД', async () => {
    const res = await deployments.create(ownerId, workspaceId, dto());
    expect(Object.keys(res).sort()).toEqual([
      'commitSha',
      'configId',
      'containerId',
      'createdAt',
      'durationMs',
      'errorCode',
      'exitCode',
      'finishedAt',
      'id',
      'imageTag',
      'projectId',
      'startedAt',
      'status',
      'step',
      'triggeredById',
    ]);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});
```

Run: `npx jest src/modules/deployments/deployments.service` → Expected: FAIL (`deployments.service_1.DeploymentsService is not a constructor`).

- [x] **Step 3: Реализовать сервис**

Заменить `src/modules/deployments/deployments.service.ts` (4 строки):

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Deployment,
  DeploymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DeployConfigsService } from '../projects/deploy-configs.service';
import { ProjectsService } from '../projects/projects.service';
import type { CreateDeploymentDto } from './dto/create-deployment.dto';
import type { ListDeploymentsQueryDto } from './dto/list-deployments-query.dto';
import { DeployRunnerService } from './deploy-runner.service';
import type {
  DeployErrorCode,
  DeployStepName,
  DeploymentLogsResponse,
  DeploymentResponse,
} from './deployment.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const FINISHED: DeploymentStatus[] = [
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.INTERRUPTED,
];

function toResponse(row: Deployment): DeploymentResponse {
  return {
    id: row.id,
    projectId: row.projectId,
    configId: row.configId,
    status: row.status,
    // Протокол lowercase (`preflight`), БД — enum (`PREFLIGHT`): обратная
    // конверсия к `toPrismaStep` из Task 6, проверяется тестом findOne.
    step: row.step ? (row.step.toLowerCase() as DeployStepName) : null,
    imageTag: row.imageTag,
    commitSha: row.commitSha,
    containerId: row.containerId,
    // errorCode в БД — свободная строка (Task 1), словарь живёт в TypeScript
    errorCode: row.errorCode as DeployErrorCode | null,
    exitCode: row.exitCode,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    triggeredById: row.triggeredById,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projects: ProjectsService,
    private readonly configs: DeployConfigsService,
    private readonly runner: DeployRunnerService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateDeploymentDto,
  ): Promise<DeploymentResponse> {
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );
    const project = await this.projects.requireRow(dto.projectId, workspaceId);
    const config = await this.configs.requireRow(dto.configId, project.id);

    let row: Deployment;
    try {
      row = await this.prisma.deployment.create({
        data: {
          projectId: project.id,
          configId: config.id,
          triggeredById: userId,
          // Уникальный activeConfigId и есть очередь «одна активная задача на
          // конфигурацию»: вставка либо занимает слот, либо даёт P2002.
          activeConfigId: config.id,
          // Снимок — контракт исполнения (ревью №7): исполнитель строит план
          // из него, поэтому сюда попадает всё, что уходит в shell.
          snapshot: {
            method: config.method,
            ref: config.ref,
            dockerfile: config.dockerfile,
            containerName: config.containerName,
            ports: config.ports,
            repoUrl: project.repoUrl,
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'a deployment for this config is already queued or running',
        );
      }
      throw err;
    }

    // Задача уже видна очереди (вставка завершилась), поэтому мы не передаём id:
    // исполнитель сам возьмёт самую старую QUEUED в пределах свободных слотов.
    // `pump` не бросает наружу (Task 6).
    this.runner.pump();
    return toResponse(row);
  }

  async findAll(
    userId: string,
    workspaceId: string,
    query: ListDeploymentsQueryDto,
  ): Promise<DeploymentResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    // `limit` уже проверен регуляркой на границе (1..100); `Math.min` здесь
    // только на случай прямого вызова сервиса из другого кода
    const take = Math.min(Number(query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const rows = await this.prisma.deployment.findMany({
      where: {
        project: { workspaceId },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.configId ? { configId: query.configId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map(toResponse);
  }

  async findOne(userId: string, deploymentId: string): Promise<DeploymentResponse> {
    return toResponse(await this.scoped(userId, deploymentId));
  }

  async logs(userId: string, deploymentId: string): Promise<DeploymentLogsResponse> {
    const row = await this.scoped(userId, deploymentId);
    return {
      deploymentId: row.id,
      status: row.status,
      finished: FINISHED.includes(row.status),
      log: row.log,
      sizeBytes: Buffer.byteLength(row.log, 'utf8'),
    };
  }

  /**
   * Плоский маршрут: воркспейс известен только из самой строки, поэтому порядок
   * такой — прочитать, проверить членство, отдать. 403 от `requireMembership`
   * гасится в 404: он подтвердил бы, что чужая задача существует.
   */
  private async scoped(userId: string, deploymentId: string) {
    const row = await this.prisma.deployment.findFirst({
      where: { id: deploymentId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!row) throw new NotFoundException('deployment not found');
    try {
      await this.workspaces.requireMembership(
        userId,
        row.project.workspaceId,
        MEMBER_ROLES,
      );
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        throw new NotFoundException('deployment not found');
      }
      throw err;
    }
    return row;
  }
}
```

Ни одного поля не уходит наружу до проверки доступа, поэтому одно чтение вместо двух достаточно: фильтр `where: { project: { workspaceId } }` требует знать `workspaceId` заранее, а его как раз и даёт включённая связь `project`.

- [x] **Step 4: Прогнать сервис**

Run: `npx jest src/modules/deployments/deployments.service` → Expected: все PASS. `npx tsc --noEmit -p tsconfig.json` → Expected: пусто (проверить, что `snapshot` принимает литеральный объект: поле `Json?`, `Prisma.JsonObject` не требуется).

- [x] **Step 5: Контроллеры и модуль**

Заменить `src/modules/deployments/deployments.controller.ts` (7 строк):

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottleProfile } from '../../common/throttle/throttle-profile.decorator';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { DeploymentIdsDto } from './dto/deployment-ids.dto';
import { ListDeploymentsQueryDto } from './dto/list-deployments-query.dto';

@Controller('workspaces/:workspaceId/deployments')
@UseGuards(JwtAuthGuard)
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post()
  @HttpCode(202)
  @ThrottleProfile('sshOps')
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateDeploymentDto,
  ) {
    return this.deploymentsService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  list(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Query() query: ListDeploymentsQueryDto,
  ) {
    return this.deploymentsService.findAll(user.userId, params.workspaceId, query);
  }
}

@Controller('deployments')
@UseGuards(JwtAuthGuard)
export class DeploymentController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Get(':deploymentId')
  one(@User() user: JwtUserPayload, @Param() params: DeploymentIdsDto) {
    return this.deploymentsService.findOne(user.userId, params.deploymentId);
  }

  @Get(':deploymentId/logs')
  logs(@User() user: JwtUserPayload, @Param() params: DeploymentIdsDto) {
    return this.deploymentsService.logs(user.userId, params.deploymentId);
  }
}
```

Два класса-контроллера в одном файле — потому что `API.md:121-122` даёт детали и логи плоским путём `api/v1/deployments/:deployment_id`, а один `@Controller()` держит один префикс; вынести второй в `deployment.controller.ts` означало бы делить один модуль по имени файла, а не по ответственности.

Заменить `src/modules/deployments/deployments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { ServersModule } from '../servers/servers.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DeploymentsController, DeploymentController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { DeployRunnerService } from './deploy-runner.service';

@Module({
  imports: [
    PrismaModule,
    WorkspacesModule,
    // SSH_RUNNER и ServersService — от них зависят loadForSsh и exec исполнителя
    ServersModule,
    // ProjectsService/DeployConfigsService: requireRow для области видимости
    ProjectsModule,
  ],
  controllers: [DeploymentsController, DeploymentController],
  providers: [DeploymentsService, DeployRunnerService],
})
export class DeploymentsModule {}
```

`DeploymentsModule` уже импортирован в `app.module.ts:28`, `ProjectsModule` — в `:24`; менять `app.module.ts` не нужно. `app.backend` не имеет `forwardRef`: `DeploymentsService → DeployRunnerService → ServersService`, и ни одна стрелка не возвращается в `DeploymentsModule`.

- [x] **Step 6: Полный чек**

```bash
cd app/backend && npx jest src/modules/deployments src/modules/projects && npx tsc --noEmit -p tsconfig.json && npm run build && npx eslint src/modules/deployments src/modules/projects && npx prettier --write "src/modules/deployments/**/*.ts"
```

Expected: всё зелёно; `nest build` без ошибок.

- [ ] **Step 7: Коммит**

```bash
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/src/modules/deployments
git commit -m "feat(backend): deployment queue, history, details and logs endpoints

Очередь «не более одной активной задачи на конфигурацию» держится уникальным
activeConfigId, который занимает сама вставка: P2002 превращается в 409, и это
один запрос вместо «прочитал-и-записал». POST не ходит на хост — 202 возвращается
до первого KEX, а недоступность хоста становится состоянием задачи, а не ошибкой
HTTP-запроса. Плоский GET /deployments/:id отдаёт 404 и чужой задаче: 403
подтвердил бы, что она существует.
"
```

---

## Task 8: E2E через куки, живой smoke и сверка DoD

**Files:**
- Create: `app/backend/test/deploy-core.e2e-spec.ts`
- Только временные артефакты в `/tmp` (образ и контейнер smoke, логи панели) — в репозиторий не попадают.

**Interfaces:**
- Consumes: весь срез (Tasks 1–7), харнесс `test/docker-operate.e2e-spec.ts:112-232` (тот же порядок env до `require`, `loginAs`, пин через `prisma.server.update`, `overrideProvider(SSH_RUNNER)`).
- Produces: зелёный e2e-прогон + таблица живых замеров в этом файле (шаг 5) + запись в `docs/mvp-scope.md`? — нет, `docs/mvp-scope.md` не правим: статус частей ведётся в плане.

- [x] **Step 1: Написать e2e-спек**

Create `test/deploy-core.e2e-spec.ts`. env задаются ДО `require` модулей (импорты хойстятся — приём перенесён из `docker-operate.e2e-spec.ts:10-25`):

```ts
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy?schema=public';
process.env.NODE_ENV = 'development';
process.env.EMAIL_VERIFY_MX = 'false';
process.env.THROTTLE_SSH_OPS_LIMIT = '100';
process.env.THROTTLE_AUTH_STRICT_LIMIT = '50';
process.env.SSH_ALLOWED_PORTS = '22,2202';
process.env.SSH_ALLOW_LOOPBACK = 'true';
process.env.DEPLOY_STEP_TIMEOUT_MS = '5000';
process.env.SERVER_CRYPTO_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SERVER_CRYPTO_KEY_ID = 'k1';

const { AppModule } =
  require('../src/app.module') as typeof import('../src/app.module');
const { AllExceptionsFilter } =
  require('../src/common/filters/all-exceptions.filter') as typeof import('../src/common/filters/all-exceptions.filter');
const { SSH_RUNNER } =
  require('../src/modules/servers/ssh/ssh-runner') as typeof import('../src/modules/servers/ssh/ssh-runner');
const { FakeSshRunner } =
  require('../src/modules/servers/ssh/fake-ssh.runner') as typeof import('../src/modules/servers/ssh/fake-ssh.runner');
const { PrismaService } =
  require('../src/database/prisma/prisma.service') as typeof import('../src/database/prisma/prisma.service');
const { ACCESS_COOKIE_NAME } =
  require('../src/modules/auth/auth-cookies') as typeof import('../src/modules/auth/auth-cookies');
const { DeployRunnerService } =
  require('../src/modules/deployments/deploy-runner.service') as typeof import('../src/modules/deployments/deploy-runner.service');
const { DeploymentsController } =
  require('../src/modules/deployments/deployments.controller') as typeof import('../src/modules/deployments/deployments.controller');
const { THROTTLE_PROFILE_KEY } =
  require('../src/common/throttle/throttle-profile.decorator') as typeof import('../src/common/throttle/throttle-profile.decorator');

const PIN = `SHA256:${'A'.repeat(43)}`;

function stepOut(step: string, markers: string[] = [], log = 'ok'): string {
  return [
    `BIOS_STEP=${step}`,
    'BIOS_RC=0',
    ...markers,
    'BIOS_LOG_BEGIN',
    log,
    'BIOS_LOG_END',
  ].join('\n');
}

describe('deploy core e2e (cookies + fake ssh)', () => {
  let app: INestApplication<App>;
  let prisma: InstanceType<typeof PrismaService>;
  let ssh: InstanceType<typeof FakeSshRunner>;

  function idOf(res: { body: unknown }): string {
    return (res.body as { id: string }).id;
  }

  async function loginAs(email: string, username: string): Promise<string[]> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, email, password: 'secret123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);
    const cookies = login.get('set-cookie') as unknown as string[];
    expect(cookies.join(';')).toContain(ACCESS_COOKIE_NAME);
    return cookies;
  }

  let serverOrdinal = 0;

  /**
   * Всё, что нужно до деплоя: воркспейс → сервер (пин прямо в БД, TOFU проверен
   * в servers.e2e-spec) → проект → конфигурация. Возвращает id'ы и куки.
   */
  async function onboard(email: string, username: string, pin: string | null = PIN) {
    const cookies = await loginAs(email, username);
    const ws = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Cookie', cookies)
      .send({ name: `dp-${username}` })
      .expect(201);
    const workspaceId = idOf(ws);
    serverOrdinal += 1;
    const server = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: `${username}-host`,
        host: `203.0.113.${49 + serverOrdinal}`,
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    if (pin !== null) {
      await prisma.server.update({
        where: { id: idOf(server) },
        data: { hostKeyFingerprint: pin },
      });
    }
    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Cookie', cookies)
      .send({
        name: `${username}-shop`,
        repoUrl: 'https://github.com/octocat/hello-world.git',
      })
      .expect(201);
    const config = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceId}/projects/${idOf(project)}/deploy-configs`,
      )
      .set('Cookie', cookies)
      .send({
        name: 'prod',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: `${username}-web`,
        ports: ['8080:80'],
        serverId: idOf(server),
      })
      .expect(201);
    return {
      cookies,
      workspaceId,
      serverId: idOf(server),
      projectId: idOf(project),
      configId: idOf(config),
    };
  }

  function scriptHappyPath(): void {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60'], 'Cloning into'));
    ssh.respond(/build\.log/, stepOut('build', ['BIOS_IMAGE=sha256:aaa'], 'naming to image'));
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=c0ffee'], 'c0ffee'));
  }

  async function settle(): Promise<void> {
    await app.get(DeployRunnerService).drain();
  }

  beforeAll(async () => {
    ssh = new FakeSshRunner();
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SSH_RUNNER)
      .useValue(ssh)
      .compile();

    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
    await ssh.closeMock();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    ssh.reset();
  });

  afterEach(async () => {
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  test('полный путь: 202 → QUEUED, drain → SUCCESS, журнал из четырёх разделов, история и логи', async () => {
    const ctx = await onboard('dp-full@example.com', 'dpfull');
    scriptHappyPath();

    const queued = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    const deploymentId = idOf(queued);
    // Единственное детерминированное доказательство «202 раньше исполнения»: тело
    // сформирован из строки в статусе QUEUED. Ассерт `ssh.commands.length === 0`
    // здесь был бы гонкой: tick() стартует микрозадачей, и к моменту разрешения
    // supertest-промиса первая команда уже могла уйти в шов.
    expect(queued.body).toMatchObject({ status: 'QUEUED', step: null });

    await settle();

    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${deploymentId}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      id: deploymentId,
      status: 'SUCCESS',
      step: 'run',
      commitSha: '7fd1a60',
      containerId: 'c0ffee',
      errorCode: null,
    });
    expect(details.body.imageTag).toBe(`bios-deploy:${deploymentId}`);

    const logs = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${deploymentId}/logs`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(logs.body.finished).toBe(true);
    for (const step of ['preflight', 'source', 'build', 'run']) {
      expect(logs.body.log).toContain(`===== ${step} =====`);
    }
    expect(logs.body.sizeBytes).toBe(
      Buffer.byteLength(logs.body.log as string, 'utf8'),
    );

    const history = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ id: deploymentId, status: 'SUCCESS' });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(list.body[0]).toMatchObject({ id: ctx.projectId });
    const configs = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
      )
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(configs.body[0]).toMatchObject({
      id: ctx.configId,
      ports: ['8080:80'],
      method: 'GIT_PULL',
    });
    ssh.assertNoSecretLeak('sup3rsecret');
  });

  test('граница DTO отклоняет до записи в БД: credentials, http, git-синтаксис, абсолютный путь, порт 0, чужое поле, чужой метод', async () => {
    const ctx = await onboard('dp-bad@example.com', 'dpbad');
    const badProjects: Record<string, unknown>[] = [
      { name: 'x', repoUrl: 'https://user:token@github.com/a/b.git' },
      { name: 'y', repoUrl: 'http://github.com/a/b' },
      { name: 'z', repoUrl: 'git@github.com:a/b.git' },
      { name: 'w', repoUrl: 'https://169.254.169.254/latest/meta-data' },
    ];
    for (const body of badProjects) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
        .set('Cookie', ctx.cookies)
        .send(body)
        .expect(400);
    }

    const badConfigs: Record<string, unknown>[] = [
      { name: 'c1', method: 'GIT_PULL', ref: 'main^', containerName: 'c1', serverId: ctx.serverId },
      { name: 'c2', method: 'GIT_PULL', ref: 'master', dockerfile: '../Dockerfile', containerName: 'c2', serverId: ctx.serverId },
      { name: 'c3', method: 'GIT_PULL', ref: 'master', containerName: 'c3', serverId: ctx.serverId, ports: ['0:80'] },
      { name: 'c4', method: 'COMPOSE', ref: 'master', containerName: 'c4', serverId: ctx.serverId },
      { name: 'c5', method: 'GIT_PULL', ref: 'master', containerName: 'c5', serverId: ctx.serverId, extra: 1 },
      { name: 'c6', method: 'GIT_PULL', ref: 'master', containerName: '-c6', serverId: ctx.serverId },
    ];
    for (const body of badConfigs) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
        )
        .set('Cookie', ctx.cookies)
        .send(body)
        .expect(400);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: 'not-a-uuid' })
      .expect(400);

    // ни одного лишнего проекта и ни одной лишней конфигурации
    expect(await prisma.project.count({ where: { workspaceId: ctx.workspaceId } })).toBe(1);
    expect(await prisma.deployConfig.count({ where: { projectId: ctx.projectId } })).toBe(1);
  });

  test('роли: MEMBER не создаёт ничего, но читает историю; без куки — 401', async () => {
    const ctx = await onboard('dp-owner@example.com', 'dpowner');
    scriptHappyPath();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    // Приглашения — часть 2; участника заводим напрямую в БД, чтобы деплой-спек
    // не тек вместе с механизмом инвайтов. Регистрируем через loginAs и читаем id
    // из Prisma: форма ответа /auth/register нам здесь не союзник.
    const memberCookies = await loginAs('dp-member@example.com', 'dpmem');
    const memberRow = await prisma.user.findFirstOrThrow({
      where: { email: 'dp-member@example.com' },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: memberRow.id,
        role: 'MEMBER',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', memberCookies)
      .send({ name: 'mem-shop', repoUrl: 'https://github.com/octocat/Hello-World' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`)
      .set('Cookie', memberCookies)
      .send({ name: 'mem', method: 'GIT_PULL', ref: 'master', containerName: 'mem-web', serverId: ctx.serverId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', memberCookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', memberCookies)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(created)}`)
      .set('Cookie', memberCookies)
      .expect(200);

    for (const path of [
      `/api/v1/workspaces/${ctx.workspaceId}/projects`,
      `/api/v1/workspaces/${ctx.workspaceId}/deployments`,
      `/api/v1/deployments/${idOf(created)}`,
      `/api/v1/deployments/${idOf(created)}/logs`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(401);
  });

  test('чужие id — 404 на обоих концах: проект из другого воркспейса и чужой деплой', async () => {
    const a = await onboard('dp-a@example.com', 'dpa');
    const b = await onboard('dp-b@example.com', 'dpb');

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${b.workspaceId}/projects/${a.projectId}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${b.workspaceId}/deployments`)
      .set('Cookie', b.cookies)
      .send({ projectId: a.projectId, configId: a.configId })
      .expect(404);
    // ревью №9: проверяем isolation на НАСТОЯЩЕМ деплое, а не на случайном id:
    // 404 на несуществующем объекте ничего не доказывает
    scriptHappyPath();
    const foreign = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${a.workspaceId}/deployments`)
      .set('Cookie', a.cookies)
      .send({ projectId: a.projectId, configId: a.configId })
      .expect(202);
    await settle();
    expect(
      (await prisma.deployment.findUniqueOrThrow({ where: { id: idOf(foreign) } })).status,
    ).toBe('SUCCESS');

    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(foreign)}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(foreign)}/logs`)
      .set('Cookie', b.cookies)
      .expect(404);
    // конфигурация чужого проекта под своим проектом — тоже 404
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${b.workspaceId}/deployments`)
      .set('Cookie', b.cookies)
      .send({ projectId: b.projectId, configId: a.configId })
      .expect(404);
  });

  test('дубли: имя проекта и containerName конфигурации — 409', async () => {
    const ctx = await onboard('dp-dup@example.com', 'dpdup');
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', ctx.cookies)
      .send({ name: 'dpdup-shop', repoUrl: 'https://github.com/octocat/Hello-World' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`)
      .set('Cookie', ctx.cookies)
      .send({
        name: 'other',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'dpdup-web',
        serverId: ctx.serverId,
      })
      .expect(409);
  });

  test('очередь на уровне HTTP: активная задача той же конфигурации — 409, после освобождения слота — 202', async () => {
    const ctx = await onboard('dp-queue@example.com', 'dpqueue');
    const ownerRow = await prisma.user.findFirstOrThrow({
      where: { email: 'dp-queue@example.com' },
    });
    // Слот занимаем вставкой, а не исполнителем: «одна активная задача» —
    // свойство unique-индекса (Task 1), и тест не должен зависеть от того,
    // успел ли in-process исполнитель дойти до finalize.
    await prisma.deployment.create({
      data: {
        projectId: ctx.projectId,
        configId: ctx.configId,
        triggeredById: ownerRow.id,
        activeConfigId: ctx.configId,
      },
    });

    const conflict = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(409);
    expect(conflict.body).toMatchObject({ statusCode: 409 });
    expect(await prisma.deployment.count()).toBe(1);
    // исполнитель не вызывался: 409 рождается на вставке
    expect(ssh.commands).toHaveLength(0);

    await prisma.deployment.deleteMany({});
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(1);
  });

  test('провал шага не становится ошибкой HTTP: 202, а задача FAILED с диагнозом', async () => {
    const ctx = await onboard('dp-fail@example.com', 'dpfail');
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(
      /build\.log/,
      `BIOS_STEP=build\nBIOS_RC=53\nBIOS_LOG_BEGIN\ndockerfile parse error\nBIOS_LOG_END`,
      { code: 53 },
    );
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      status: 'FAILED',
      step: 'build',
      errorCode: 'BUILD_FAILED',
      exitCode: 53,
    });
    // шаг run не исполнялся
    expect(ssh.commands).toHaveLength(3);
    const logs = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}/logs`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(logs.body).toMatchObject({ finished: true, status: 'FAILED' });
    expect(logs.body.log).toContain('dockerfile parse error');
  });

  test('незапиненный хост: 202 без единого SSH-соединения, задача HOST_KEY_NOT_TRUSTED', async () => {
    const ctx = await onboard('dp-nopin@example.com', 'dpnopin', null);
    scriptHappyPath();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    expect(ssh.commands).toHaveLength(0);
    expect(ssh.sessions).toHaveLength(0);
    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      status: 'FAILED',
      errorCode: 'HOST_KEY_NOT_TRUSTED',
      step: null,
    });
  });

  test('query: limit=abc — 400, limit=1 — одна запись, configId фильтрует', async () => {
    const ctx = await onboard('dp-query@example.com', 'dpquery');
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    // слот освободил сам finalize SUCCESS — второй POST это и проверяет
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    // ревью №8: `^\d{1,3}$` пропускал '0' и '000', и список становился пустым
    // при сообщении «разрешены 1..100»
    for (const bad of ['abc', '0', '000', '101']) {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments?limit=${bad}`)
        .set('Cookie', ctx.cookies)
        .expect(400);
    }
    const limited = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments?limit=1`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(limited.body).toHaveLength(1);
    const filtered = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${ctx.workspaceId}/deployments?configId=${ctx.configId}&projectId=${ctx.projectId}`,
      )
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(filtered.body).toHaveLength(2);
    const wrongProject = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments?projectId=${ctx.serverId}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(wrongProject.body).toEqual([]);
  });

  test('POST /deployments получает профиль sshOps, чтения остаются на global', () => {
    expect(
      Reflect.getMetadata(THROTTLE_PROFILE_KEY, DeploymentsController.prototype.create),
    ).toBe('sshOps');
    expect(
      Reflect.getMetadata(THROTTLE_PROFILE_KEY, DeploymentsController.prototype.list),
    ).toBeUndefined();
  });
});
```

Пять мест, где этот спек намеренно отступает от «чистого» e2e:

- `onboard()` пишет пин в БД вместо прохождения TOFU-последовательности: probe/confirm проверены в `servers.e2e-spec.ts`, а здесь они только тормозили бы тест.
- Участник заводится через `prisma.workspaceMember.create`, а не-invite: механизм приглашений — часть 2, и её тесты не должны течь вместе с деплоем.
- `settle()` = `app.get(DeployRunnerService).drain()`: единственный способ дождаться in-process исполнителя без поллинга. Побочный эффект — спек проверяет `drain` вместе с бизнес-логикой, и это правильно.
- Очередь (409) проверяется на занятом слоте, вставленном напрямую: `updateMany`/`create` по unique-индексу — тот механизм, который тестируется, и ждать в тесте «исполнитель ещё не дошёл до finalize» значило бы писать тест на гонку.
- Каждый `onboard()` получает свой хост (`203.0.113.${49 + serverOrdinal}`), иначе `@@unique([workspaceId, hostKeyFingerprint])` части 3 сталкивает одинаковые пины между тестами.

Отдельно про `test/app.e2e-spec.ts`: он остаётся красным с прошлого прогона (дефект не этого среза, см. Global Constraints), и ни один тест этого файла к нему не добавляется.

- [x] **Step 2: Прогнать спек**

```bash
cd app/backend && npx jest --config test/jest-e2e.json deploy-core
```

Expected: 10 тестов PASS. Отдельно проверить, что процесс завершился сам (висячий сокет = незакрытый `closeMock()`), и что `npx jest`-parts по-прежнему зелёные: `npx jest src/modules/deployments src/modules/projects src/modules/servers`.

- [x] **Step 3: Живой smoke — инфраструктура**

Образ тот же, что в частях 3–4, плюс `git` (замер п.1: в `bios-sshd-p4` git ОТСУТСТВУЕТ, и preflight обязан это ловить):

```bash
mkdir -p /tmp/bios-sshd-p5 && cd /tmp/bios-sshd-p5
printf 'FROM alpine:3.20\nRUN apk add --no-cache openssh docker-cli git\nRUN echo "root:P4ssw0rd-smoke" | chpasswd\nRUN ssh-keygen -A\nRUN sed -i -e "s/^#*PasswordAuthentication.*/PasswordAuthentication yes/" -e "s/^#*PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config\nEXPOSE 2222\nCMD ["/usr/sbin/sshd","-D","-p","2222","-e"]\n' > Dockerfile
docker build -t bios-sshd-p5 .
docker run -d --name bios-sshd-p5 -p 127.0.0.1:2204:2222 -v /var/run/docker.sock:/var/run/docker.sock bios-sshd-p5
docker exec bios-sshd-p5 sh -c 'command -v git && git --version && docker info >/dev/null && echo HOST_OK'
```

Expected: `git version …`, `HOST_OK`. Дальше панель (порт 3000, `bios_test_deploy`, loopback разрешён только для дыма):

```bash
cd app/backend
export DATABASE_URL="postgresql://sabir@localhost:5432/bios_test_deploy?schema=public" \
  NODE_ENV=development EMAIL_VERIFY_MX=false \
  SSH_ALLOWED_PORTS=22,2204 SSH_ALLOW_LOOPBACK=true \
  THROTTLE_SSH_OPS_LIMIT=100 THROTTLE_AUTH_STRICT_LIMIT=50 \
  DEPLOY_ROOT_DIR=/tmp/bios-deploy DEPLOY_HOST_LOG_BYTES=65536 \
  SERVER_CRYPTO_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
npm run build && node dist/main > /tmp/bios-panel-p5.log 2>&1 &
printf '%s' $! > /tmp/bios-panel-p5.pid
for i in $(seq 1 60); do curl -sf localhost:3000/api/v1/health >/dev/null && break; sleep 0.25; done
```

- [x] **Step 4: Живой smoke — сценарий**

Куки брать парой `-c/-j` на login и `-b` на остальные (ошибка прошлого прогона: `curl -b` без `-c` → куки не сохранились, и весь дым отвалился на 401).

Реальный публичный репозиторий для SUCCESS-прогона: `https://github.com/docker/whalesay`, ref `master`, dockerfile `Dockerfile` — измерено 2026-10-10: `git ls-remote --heads --tags https://github.com/docker/whalesay master` → `7a94200 refs/heads/master`, `rc=0`; `https://raw.githubusercontent.com/docker/whalesay/master/Dockerfile` → `200`, содержимое `FROM alpine` + `apk add perl` + `COPY cowsay` (сборка тянет только `alpine` и пакет perl, то есть остаётся в пределах минуты).

| # | Шаг | Ожидаемое | Что замерить |
|---|---|---|---|
| 1 | `POST …/servers` + probe + confirm (часть 3) | `200` с `hostKeyFingerprint` | отпечаток совпадает с `ssh-keyscan -p 2204 127.0.0.1` |
| 2 | `POST …/projects` (whalesay) | `201` | — |
| 3 | `POST …/deploy-configs` (`master`, `Dockerfile`, containerName `bios-p5-web`, ports `[]`) | `201` | — |
| 4 | `POST …/deployments` | `202`, `status: QUEUED` | время ответа < 100 мс: деплой не блокирует запрос |
| 5 | `GET /deployments/:id` сразу после 202 | `QUEUED` или `RUNNING` | доказательство асинхронности |
| 6 | поллинг до терминального статуса | `SUCCESS`, `commitSha` = `7a94200…`-префикс, `imageTag` = `bios-deploy:<id>`, `containerId` непустой | полная длительность и число `Accepted password` в `docker logs bios-sshd-p5` (замер п.8: ожидается ровно 4 — по одному на шаг) |
| 7 | `docker exec bios-sshd-p5 docker ps -a --filter name=bios-p5-web` | контейнер создан | `ls /tmp/bios-deploy/<project>/<config>/logs/` содержит `preflight.log … run.log` и `.kv`-файлы |
| 8 | `GET /deployments/:id/logs` | журнал из четырёх разделов, в `build` — реальные строки docker | `sizeBytes` против `wc -c` на хосте: в панель приехал хвост, полный лог остался там |
| 9 | повторный `POST …/deployments` без завершения | `409` | слот занят — очередь работает на живом индексе |
| 10 | `ref: nosuchbranch` (вторая конфигурация) | `FAILED`, `errorCode: REF_NOT_FOUND` | `ls-remote` с нулём строк (замер п.6), ни одной попытки clone |
| 11 | `dockerfile: Dockerfile.missing` | `FAILED`, `errorCode: DOCKERFILE_MISSING` | шаг source реально обновил working tree, build не начинался |
| 12 | `kill $(cat /tmp/bios-panel-p5.pid)`, затем старт панели заново | `GET …/deployments` показывает `INTERRUPTED` у незавершённых | незавершённую задачу надо успеть оставить: убивать панель между шагами 4 и 6 отдельного прогона. Если незавершённых нет — записать «reconcile живым примером не подтверждён», а не выдавать юнит-замер Task 6 за живой |
| 13 | MEMBER (второй пользователь) | `POST …/deployments` → `403`, `GET …/deployments` → `200` | |
| 14 | `docker run -d -p 127.0.0.1:8080:80 <покупой образ>` на хосте, затем деплой с портом `8080:80` | `FAILED`, `errorCode: RUN_FAILED` | `docker ps -a` на хосте: старый контейнер УЖЕ удалён шагом `run` (Known gaps №8) — замер подтверждает, что мы это знаем, а не прячем |
| 15 | `docker exec bios-sshd-p5 wc -c /tmp/bios-deploy/*/*/logs/build.log` | не больше `DEPLOY_HOST_LOG_BYTES` (65536) | полный лог сборки > 64 КБ, значит хост ограничен (ревью, «остальное»); в панели при этом `sizeBytes ≤ DEPLOY_LOG_TAIL_BYTES` |
| 16 | второй `POST …/deployments` после завершения первого | `202` | слот освобождён finalize — на живом индексе, а не в юните |

Уборка: `docker rm -f bios-p5-web` и occupant-контейнер (на хосте), `docker rm -f bios-sshd-p5`, `rm -rf /tmp/bios-sshd-p5 /tmp/bios-deploy`, панель убивать по PID из `/tmp/bios-panel-p5.pid`, не `pkill -f`.

- [x] **Step 5: Записать замеры и сверить DoD**

В конец этого файла добавить раздел «Живой smoke (выполнено <дата>)» с фактическими числами (длительность деплоя, число авторизаций sshd, размеры журналов панель/хост) и таблицу DoD против `docs/mvp-scope.md` §5: модели есть, 9 маршрутов живые, e2e через куки `access_token`, заглушек `→ null/[]` нет, метрика «первый деплой < 10 мин» измерена.

Пункты, которые DoD этого среза НЕ закрывает и которые надо назвать вслух (не прятать в «потом'): откат, автодеплой по push, `docker-compose`/shell/custom методы, редактирование и удаление конфигурации, UI. Все они — следующие срезы этого же файла (roadmap ниже), и ни один не реализован заглушкой.

- [ ] **Step 6: Коммит**

```bash
cd /Users/sabir/Desktop/Работа/Bios && git add app/backend/test/deploy-core.e2e-spec.ts docs/superpowers/plans/2026-10-10-deploy-core.md
git commit -m "test(backend): deploy core e2e and part-5 plan with live smoke results

E2E проверяет главный контракт среза: POST отвечает 202 до первой команды на
хосте, а недоступность хоста, отсутствие git и чужая ветка становятся
состояниями задачи, а не ошибками HTTP. Живой smoke считает число авторизаций
sshd на деплой (ожидаем 4 — по одной на шаг) и сверяет размер журнала:
полный лог остаётся на хосте, в панель приезжает хвост.
"
```

---

## Roadmap: остальные четыре среза deploy-подсистемы

Владелец описал подсистему в терминах **4 методов** и **7 возможностей**. Срез 1 закрывает ручной деплой, статусы, журнал, длительность и историю — пять из семи; ниже то, что осталось. Каждый пункт — отдельный план в этом же каталоге, и ни один не начинается, пока не промеряны его «что измерить до плана». Порядок можно менять, кроме среза 2: он не вводит новых гарантий безопасности, а значит самый дешёвый.

| Срез | Что добавляется | Что уже есть и расширяется | Что измерить до плана |
|---|---|---|---|
| **2. Методы: `COMPOSE`, `SHELL_SCRIPT`, `CUSTOM_COMMANDS`** | Тела шагов под каждый метод; `dockerfile` уходит из контракта compose/shell; новый шаг `VALIDATE` для compose-файла | `DeployMethod` в схеме уже содержит 4 значения (Task 1); `SUPPORTED_METHODS` в DTO сужает до `GIT_PULL` (Task 4); `buildDeployPlan` уже принимает plan-вход и не знает про метод | версия `docker compose` на хосте (v2 `docker compose` против v1 `docker-compose` — разные CLI); поведение `docker compose up -d` при уже поднятом проекте; нужен ли `--project-directory` при `dockerfile` в подкаталоге |
| **3. Rollback** | `POST /deployments/:id/rollback` = новый деплой по сохранённому `imageTag`; шаг `prune` с политикой хранения образов и **тогда же** появляется `DEPLOY_KEEP_IMAGES` | `imageTag`, `commitSha`, `snapshot` уже пишутся в историю (Task 6), поэтому миграции не потребуется | сколько образов реально хранится на 1000-деплойном хосте и какой `docker image prune` безопасен при общем демоне (часть 4 показывает чужие контейнеры — значит и чужие образы трогать нельзя) |
| **4. Автодеплой: расписания и webhook** | Модель `DeploySchedule`, динамический CronJob (образец `maintenance.service.ts`), webhook-приёмник; таблица `…/deploy-configs/:configId/schedules` из `API.md:114-116` | `DeploymentsService.create` уже принимает `triggeredById`, так что «запуск от имени расписания» = системный id; очередь (activeConfigId) защищает от наложения автодеплоя и ручного | mvp-scope §5 прямо выносит `schedules` за MVP: этот срез — решение владельца сверх скоупа, и до плана надо подтвердить, что метрика «`git push → deploy`» требует webhook, а не поллинга |
| **5. История конфигурации, метрики и стриминг** | `GET …/deploy-configs/:configId/history` (`API.md:117`), курсорная пагинация вместо `limit`, агрегаты (p50/p95 длительности, доля неудач), retention журнала, **и streaming exec в шве части 3** (`ssh2` `client.exec` + инкрементальный разбор конверта) — закрывает Known gaps 7: сегодня пик RAM панели = весь stdout шага | `@@index([configId, createdAt])` уже в схеме (Task 1); `ListDeploymentsQueryDto` уже фильтрует по конфигурации; `readLogs` части 4 уже читает кадр логов по частям — образец есть | размер журнала после 10k деплоев (строка `log` в БД = 4 × `DEPLOY_LOG_TAIL_BYTES`, то есть до 128 КБ на запись) и где хранить полные логи: на хосте они уже есть, и план должен решить, читаёт ли их панель оттуда; какой объём stdout реально даёт `docker build` на типовом образе (это и есть потолок RAM панели до стриминга) |

Ещё одна развилка, которая относится не к срезам, а к продукту: UI. MVP-скоуп (§5) просит «endpoint + модель + guard + e2e», и части 3–4 уже отложили интерфейс по решению владельца. Деплой без экрана — это осознанно незакрытая метрика «первый деплой < 10 мин»: её можно измерить только через API/CLI, и в плане это зафиксировано в Known gaps.

---

## Само-ревью плана (пройдено 2026-10-10 по чек-листу скилла)

**1. Покрытие скоупа.** Пройден `docs/mvp-scope.md` §5 построчно: проект (Task 3), конфигурация деплоя (Task 4), ручной деплой (Task 6–7), логи деплоя (Task 6 журнал + Task 7 `GET /deployments/:id/logs`), статусы (enum `DeploymentStatus` + `step`), длительность (`startedAt`/`finishedAt`/`durationMs`). DoD §5 («endpoint + Prisma-модель + guard/workspace-scoping + e2e через куки `access_token`, без заглушек `→ null/[]`») закрыт Task 1, 3–7 и e2e Task 8. Явно вынесено за срез и названо в таблице маршрутов, а не заглушено: CRUD-правка/удаление проекта и конфигурации, детали конфигурации, `schedules`, `history` по конфигурации, `rollback`, три других метода.

**2. Плейсхолдеры.** Поиск по `TBD|TODO|«похоже на Task N»|«аналогично»|« appropriate »` дал 0 совпадений в шагах. Каждый шаг с кодом содержит код, каждый шаг с тестом содержит тест. Фразы «см. код ниже» есть только внутри одного `Interfaces`-блока, где код следует через пару строк.

**3. Консистентность типов между задачами.** Проверено и исправлено по ходу:
- `DeployStepName` — один и тот же строчный union в Task 5 (`deployment.types.ts`) и в Task 6/7; Prisma-enum `PREFLIGHT…RUN` нигде не импортируется рядом, конверсия только через `toPrismaStep`/`.toLowerCase()`.
- `DeploymentResponse` из Task 5 и ассерт `Object.keys(res)` в Task 7 — 15 полей, сходятся (изначальный `imageName` удалён как мёртвое поле: `imageTag` достаточно для rollback-среза).
- `DeployConfigResponse.method` закреплён литералом `'GIT_PULL'` (Task 4), и `DeployPlanInput` в Task 5 не знает про метод — расширение среза 2 не трогает билдер.
- `testAppConfig(ssh, docker, deploy)` — трёхаргументная сигнатура согласована в Task 2 (реализация) и в вызовах Task 6/7/8.
- `FakeSshRunner.exec` получает третий параметр в Task 6 — проверено, что ни один существующий вызов (`agent.service.ts:270`, `docker.service.ts`) от этого не ломается, потому что параметр добавляется в реализацию, а не в контракт.
- Убран мёртвый конфиг `keepImages` из Task 2: в этом срезе образы не удаляются, и настройка без исполнителя превращается в обещание, которое никто не даёт.
- Убран лишний `deploy-config-ids.dto.ts` (Task 4): обязательного `configId` нет ни в одном пути среза, а глобальный `ValidationPipe` без `skipMissingProperties` (замер: `main.ts:29-33`) ответил бы 400 на живом запросе.

---

**4. Раунд внешнего ревью (2026-10-10).** План был отдан независимому ревьюеру;
тот нашёл 11 закрываемых проблем и прислал список «что ещё стоит поправить».
Пункты 1–11 ниже — его нумерация, на неё ссылается Known gaps.

**Принято и исправлено в тексте плана (P1, до реализации):**
1. Маркеры конверта парсились из всего stdout, поэтому вывод сборки, напечатавший
   `BIOS_RC=0`, превращал провал в успех → разбор только из области ДО
   `BIOS_LOG_BEGIN` (`protocolOk`), плюс обязательное совпадение `BIOS_RC` с кодом
   SSH-канала; unit-тест на подделку и sandbox-тест с настоящим `/bin/sh`.
2. `git ls-remote … | grep -q .` в POSIX-шелле теряет код `ls-remote` (замер п.11:
   код конвейера = код последней команды) → сетевой сбой получал `REF_NOT_FOUND`;
   теперь вывод в `source.probe`, отдельно rc команды (`exit 52` → `SOURCE_FAILED`)
   и отдельно пустота (`exit 51` → `REF_NOT_FOUND`), sandbox-тест на оба.
3. `@@unique([projectId, containerName])` не защищал от `docker rm -f` чужого
   контейнера на том же демоне → добавлен `@@unique([serverId, containerName])`,
   обновлены текст P2002 и тест: два проекта, один сервер, одно имя = 409.
4. `deployCodeOfSsh` возвращал `HOST_KEY_MISMATCH`, которого нет в union
   `DeployErrorCode` (tsc бы не пропустил) → значение добавлено в union вместе с
   `AUTH_FAILED`/`REFUSED`/`DNS`/`SNAPSHOT_INVALID`/`ACCESS_LOST`, и шаг требует
   прогнать `tsc --noEmit`, а не только Jest.

**Принято и исправлено (P2 и «ещё»):** нормализация `repoUrl` больше не режет
регистр пути (замер: `new URL` бросает TypeError на порте 99999 → порт теперь
ограничен 1–65535, а исключение разбора превращается в `BadRequestException`);
`limit` валидируется диапазоном `^(?:[1-9]\d?|100)$` (000 больше не проходит);
e2e чужого воркспейса проверяет 404 на НАСТОЯЩЕМ id деплоя, а не на `projectId`
(предыдущая проверка ничего не проверяла); исполнитель берёт «что деплоить» из
`snapshot` и падает в `SNAPSHOT_INVALID`, если снимок битый — расхождение снимка и
живых значений закрыто; добавлены `pump()`/`maxParallel` (очередь, а не вызов
`start()` на каждый POST); `rev-parse HEAD` пишет полный SHA; `assertPortMappings`
сравнивает числа, а не строки (08080 == 8080); SSH-диагнозы больше не схлопнуты в
`HOST_UNREACHABLE`; на хосте появился `DEPLOY_HOST_LOG_BYTES` — файл шага
обрезается `tail -c` на самом хосте, а не только в панели; single-replica
ограничение вынесено в Known gaps 2 явным требованием.

**Отклонено с причинами (не «потом», а осознанный отказ в этом срезе):**
- Проверять публичность репозитория DNS-запросом панели. Это SSRF-граница,
  которую панель не может корректно построить из своего адреса: хост, к которому
  идёт `git clone`, после пина host key считается доверенным, а DNS-препроверка
  панели дала бы TOCTOU (ответ мог бы разойтись с тем, что резолвит клиент на
  шаге `source`). Оставлен синтаксический забор + Known gaps 12.
- Zero-downtime-замена (кандидат на других портов + health-чек + свитч).
  Требует реверс-прокси у клиента или двойного набора портов; в §5 этого нет.
  Вместо этого `RUN_FAILED` честно означает «старый контейнер уже удалён»
  (Known gaps 8) и это закреплено тестом.
- Ограничить пик RAM панели внутри шага. Без streaming exec (Known gaps 7)
  node-ssh 13.2.1 накапливает stdout до отдачи — решение на уровне шва, оно
  добавлено отдельной строкой в roadmap-срез 5.

**Что ревью подтвердил как сделанное верно:** атомарный захват задачи через
уникальный `activeConfigId`, проверка прав до первой удалённой команды, отдельный
обработчик сирот после перезапуска, ограничение размера журнала в панели, тесты
shell-строк в настоящем `/bin/sh`, разделение `projects`/`deployments` и
роль-граница «OWNER запускает, участники читают». Всё это осталось без изменений.

**Поправка к пункту 1–3 этого раздела.** До ревью само-ревью утверждало, что план
готов к реализации; это было переоценкой: четыре проблемы из P1 меняли именно
гарантии (достоверность статуса, сохранность чужого контейнера, типобезопасность
маппинга), которые срез и вводит. После раунда план пересобран, и претензия
принята — проверено не «все шаги содержат код», а «ни один шаг не обещает статус,
который исполнитель не может доказать».

**5. Правки, найденные при исполнении (2026-10-10, Tasks 0–6).** Пять мест плана
оказались неверными не на бумаге, а на прогоне — исправлены в коде и в тексте
выше, перечислены здесь, чтобы следующий исполнитель не наступал повторно:

1. *(Task 4, замер)* Два спека на одной тестовой БД в параллельных jest-воркерах
   ломают друг друга глобальным `afterEach → deleteMany({})`: 4 красных теста из
   321. Исправлено в Global Constraints и в Task 0: своя база на спекафайл.
2. *(Task 5, замер)* `mkdir -p '<logDir>'` в самой обёртке даёт подстроку `-p `,
   поэтому ассерт «ports пуст → в команде нет `-p `» проверял `mkdir`, а не флаг
   docker. Исправлено: ассерт по строке `docker run`.
3. *(Task 5, замер)* На этой машине `/usr/bin/git` существует, поэтому песочный
   тест «git отсутствует» с `PATH=<стабы>:/usr/bin:/bin` прошёл бы ложно-зелёно;
   стаба `git clone` обязана оставлять `src/.git` **и** `src/Dockerfile`, иначе
   шаг `build` падает на `DOCKERFILE_MISSING` вместо проверяемого `BUILD_FAILED`.
   Добавлены `linkCoreutils()` и `GIT_STUB_CLONE`.
4. *(Task 6, дефект плана)* `pump()` порождает `tick()` как «fire-and-forget», и
   `drain()`, вызванная сразу, видела пустой `inflight` (слот ещё не резервирован)
   и возвращалась, не дождав очереди: тест `pump → drain` давал 0 вместо 1.
   Исполнитель хранит ход движка в поле `ticking`, `drain()` ждёт то его, то
   `inflight`, пока оба не опустеют.
5. *(Task 6, дефект плана)* `step` писался только в `progress()` после
   завершения шага, поэтому наблюдаемое состояние зависшей минутной сборки —
   `RUNNING/SOURCE`, а не `RUNNING/BUILD`. Теперь шаг пишется до исполнения
   (значения SHA/CID — как писались, с подтверждённого шага).
6. *(Task 6, semantics двойника)* `FakeSshRunner.respond` отдаёт ПЕРВЫЙ
   неиспользованный ответ по регулярке, поэтому тест «код 0 без конверта» не мог
   переписать build-ответ через `scriptHappyPath() + respond(...)`: переписанный
   ответ оставался невостребованным, и шаг проходил успешно. Тест теперь
   скрипует все четыре шага целиком.
7. *(Task 7, замер)* Тест «list: не участник воркспейса — 403» был неправ о
   кодовой базе: `requireMembership` бросает `NotFoundException` для отсутствующего
   членства, и части 3/4 полагаются на это. Ожидание исправлено на 404; 403
   остаётся там, где он и есть, — у участника с ролью MEMBER.
8. *(Сдвиг шага)* `deployCodeOfSsh` и три теста к нему переехали из Task 6 Step 1
   в Task 5: `deploy-script.spec.ts` импортирует функцию, и `tsc` падал бы на
   полпути между задачами. Task 6 Step 1 закрыт заранее.

---

## Known gaps и риски этого среза

Названы вслух, а не «потом»: пункты 1–6 были в плане до ревью, 7–13 появились
или уточнились после ревью и живого дыма.

1. **`docker run` без health-политики.** Шаг `run` успешен, когда демон вернул
   container id; контейнер, который тут же упадёт, даст `SUCCESS`. Проверка
   здоровья вне скоупа §5, и в UI это надо показывать отдельно, иначе «деплой
   прошёл» соврёт.
2. **Один экземпляр панели.** In-process исполнитель + `reconcile` корректны при
   `replicas = 1`. При втором экземпляре unique `activeConfigId` не даст двум
   задачам стартовать по одной конфигурации, но `reconcile` второго процесса
   снимет `INTERRUPTED` живую задачу первого. До масштабирования — зафиксировать
   ограничение в `docs/` или заменить очередь на advisory lock (отдельный план).
3. **Метрика «первый деплой < 10 мин» без UI.** Измеряется curl'ом (Task 8, шаг
   4 таблицы). Это следствие отложенного UI, а не дефект бэкенда.
4. **`DEPLOY_ROOT_DIR` пишется под root/sudo.** Каталог создаётся с правами
   хоста; чужой процесс с тем же uid может подменить working tree. Хост считается
   доверенным после пина host key (модель части 3), и этот риск остаётся за
   границей среза.
5. **`git clone --depth 1` + `dockerfile` в подкаталоге = контекст только этот
   подкаталог** (`--file <path>`, контекст `dirname(path)`). Для monorepo, где
   Dockerfile копирует соседние директории, это сломается; правильный выбор
   контекста — решение среза 2 (методы деплоя), а не хотфикс этого.
6. **Троттлинг `sshOps` (6/мин) ограничивает частоту POST, а не число активных
   сборок.** Отсюда пункт 11 — `maxParallel`.
7. **Пик памяти панели во время шага не ограничен.** `tail -c` на хосте и
   `logTailBytes` ограничивают то, что УЕЗЖАЕТ в панель и что ОСТАЁТСЯ на хосте,
   но node-ssh 13.2.1 накапливает весь stdout шага в RAM панели до отдачи
   (замер п.7; `execCommandStream` в этой версии нет — проверено: в собранном
   `lib/cjs/index.js` есть только `execCommand`). Настоящее решение — streaming
   exec (`ssh2` `client.exec` + инкрементальный разбор конверта, как `readLogs`
   части 4 читает кадр логов). Это правка шва части 3, а не исполнителя, и она
   вынесена в срез 5 отдельной строкой работы.
8. **Замена контейнера — stop-then-start (ревью №6).** `docker rm -f` старого
   имени выполняется ДО подтверждения нового. Значит `RUN_FAILED` означает «старый
   сервис уже удалён», а не «работает прошлая версия». Zero-downtime требует
   кандидата с другим набором портов или реверс-прокси у клиента — в MVP этого
   нет, и код ошибки это отображает честно (тест в Task 8).
9. **Полные логи на хосте относятся к последнему запуску конфигурации (ревью
   №10).** Файлы лежат в `<root>/<projectId>/<configId>/logs/<step>.log` и
   обнуляются перед шагом. В БД — хвост каждого деплоя навсегда; на хосте —
   только последний. Отдельного хранилища журналов по `deploymentId` в срезе 1
   нет, потому что без политики ротации он превратился бы в медленный рост диска
   у клиента (срез 5: retention и чтение полных журналов).
10. **Исполнитель берёт «что деплоить» из `snapshot`, а «куда» — из живой связи
    (ревью №7).** Если конфигурацию перепривязать к другому серверу между
    постановкой в очередь и стартом, задача уйдёт на НОВЫЙ сервер. В этом срезе
    перепривязка невозможна (PATCH вне среза), и это названо как контракт, а не
    как дыра: менять её надо вместе с маршрутом правки.
11. **`maxParallel` = очередь с ожиданием, а не отказ.** При заполненных слотах
    задача остаётся `QUEUED` и стартует, когда слот освобождается (`pump` после
    finalize). Побочный эффект: если панель перезапустится, пока задача стояла в
    очереди, `reconcile` помечает её `INTERRUPTED`, хотя она ни разу не
    исполнялась, — прямое следствие решения владельца «без автоперезапуска».
    Отдельный статус «не начиналась» вводит не этот срез: `step === null` при
    `INTERRUPTED` уже различает именно этот случай.
12. **Неудачный `docker run` оставляет контейнер в состоянии `Created` (замер
     живого дыма, строка 14).** `docker rm -f` уже снял старый сервис, а `docker run`
     с конфликтом портов создал контейнер и не смог его стартовать. Имя занято, порт
     — нет, и следующий деплой этой же конфигурации снимает зомби тем самым `rm -f`.
     То есть сервис после `RUN_FAILED` НЕ поднят и не «переключился на прошлую
     версию»: он просто отсутствует.
13. **Публичность репозитория — синтаксический забор.** `repoUrl` проверяется
    regex'ом и списком запрещённых имён/суффиксов; панель не резолвит DNS,
    поэтому `git.internal` отсекается списком, а проверкой адресуемости — нет.
    Полноценная SSRF-граница для `git clone` возможна только на самом хосте
    (который после пина считается доверенным) либо через предварительный DNS-запрос самой панели.

---

## Живой smoke (выполнено 2026-10-10)

Хост: контейнер `bios-sshd-p5` (alpine 3.20 + openssh + docker-cli + git 2.45.4),
SSH на `127.0.0.1:2204`, сокет демона смонтирован внутрь (тот же приём, что в
частях 3–4). Панель: `node dist/main`, `bios_test_deploy`,
`DEPLOY_ROOT_DIR=/tmp/bios-deploy`, `DEPLOY_HOST_LOG_BYTES=65536`. Репозиторий —
публичный `https://github.com/docker/whalesay`, ref `master`. Уборка: контейнеры
и `/tmp`-артефакты удалены, панель убита по PID из файла.

| Строка | Что мерилось | Факт |
|---|---|---|
| 1 | TOFU-пин против `ssh-keyscan` | sshd предлагает 3 ключа; запиненный отпечаток `SHA256:TMrS9…` совпал с одним из них (`PIN_MATCH=yes`). Первая версия проверки сравнивала со ВСЕМИ строками keyscan сразу и давала ложное `NO` — дефект замера, не продукта |
| 4 | `POST /deployments` не блокируется хостом | `202` за `time_total=0.0052 с` (47 мс вместе с запуском curl), тело `status: QUEUED, step: null` |
| 5 | асинхронность | первый же `GET /deployments/:id` после 202 → `RUNNING / preflight` |
| 6 | полный успешный деплой | `SUCCESS`, `durationMs=2240` (тёплые слои) и `9076` на холодном кэше; `commitSha=7a94200dc84bfbd945613701804338dee708e828` (совпал с `ls-remote`), `imageTag=bios-deploy:<id деплоя>`, `containerId` — 64-символьный hex |
| 6 | соединения на деплой | `Accepted password` в логе sshd: дельта **ровно 4** на один деплой — по одному новому соединению на шаг (живое подтверждение замера п.8) |
| 7 | состояние хоста | контейнер `bios-p5-web` создан; в `/tmp/bios-deploy/<project>/<config>/logs/` — `preflight.log … run.log`, `.kv`-файлы и `source.probe` |
| 8 | журнал панель/хост | панель: 4 раздела `===== step =====`, `sizeBytes=395`; хост: суммарно 319 байт (`build.log` 206, `source.log` 113, `preflight/run` 0). Панельский журнал БОЛЬШЕ суммы хостовых ровно на заголовки разделов |
| 9 | занятый слот на живом индексе | второй `POST` во время `RUNNING` → **409**, новой строки нет |
| 10 | `ref: nosuchbranch` | `FAILED / source`, `errorCode=REF_NOT_FOUND`, `exitCode=51`, `commitSha=null` → ни одной попытки clone |
| 11 | `dockerfile: Dockerfile.missing` | `FAILED / build`, `errorCode=DOCKERFILE_MISSING`, `exitCode=55`, `commitSha` заполнен → шаг `source` реально обновил working tree |
| 12 | `reconcile` живым примером | панель убита при `status=RUNNING` (слот в БД занят); после рестарта — `INTERRUPTED`, `errorCode=PANEL_RESTARTED`, `step=PREFLIGHT` сохранён, `durationMs` не null, `activeConfigId` освобождён, в журнале приписка `===== INTERRUPTED =====`, в stderr панели `1 deploy job(s) were left by the previous process and marked INTERRUPTED` |
| 13 | роли | MEMBER: `POST /deployments` → 403, `POST /projects` → 403, `GET /deployments` → 200 |
| 14 | `RUN_FAILED` и разрушающая замена | занятый порт 9080 → `FAILED / run`, `errorCode=RUN_FAILED`, `exitCode=54`; старый контейнер к этому моменту УДАЛЁН шагом `run`, оккупант порта выжил |
| 15 | кэп журнала на хосте | **ЖИВЫМ ПРИМЕРОМ НЕ ПОДТВЕРЖДЁН:** `docker build -q` на whalesay даёт 206 байт, и кэп 65536 не наступает. Механизм проверен в песочном тесте Task 5 на настоящем `/bin/sh` (стаб печатает 20 000 строк: файл на хосте ≤ 65536, в панель приезжает ≤ 4096) |
| + | утечка секрета | `P4ssw0rd-smoke` не встречается ни в хостовых журналах (`grep -rl` = 0), ни в `Deployment.log` (0) |
| + | граница DTO | 4 битых проекта и 6 битых конфигураций → 400, счётчики в БД не изменились (1 проект, 1 конфигурация) |

Метрика скоупа «первый деплой < 10 мин» измерена через API: 2.2–9.1 с от `POST`
до терминального `SUCCESS`. UI нет, поэтому измерение curl'ом — это следствие
решения владельца, а не обход требования.

### DoD скоупа (`docs/mvp-scope.md` §5) против факта

| Требование | Статус | Чем закрыто |
|---|---|---|
| Prisma-модели | есть | `Project`, `DeployConfig`, `Deployment` + миграция `20261010192150_deploy` на 10 БД |
| Endpoint'ы | 9 из 9 живые | маршруты 1–9 в таблице File Structure, проверены e2e и живым дымом |
| Guard + workspace-scoping | есть | OWNER пишет, участники читают; чужие id → 404 (e2e «роли», «чужие id») |
| E2E через куки `access_token` | 10/10 PASS | `test/deploy-core.e2e-spec.ts` |
| Без заглушек `→ null/[]` | нет таких мест | пустые списки возвращаются только когда строк действительно нет (тест `list`) |
| Статусы, журнал, длительность, история | есть | `status/step/errorCode/exitCode`, журнал 4 разделов, `startedAt/finishedAt/durationMs`, `GET …/deployments` |
| Откат, автодеплой, остальные 3 метода, правка/удаление конфигурации, UI | НЕ закрыты этим срезом | названы вслух: roadmap-срезы 2–5 и Known gaps 3 |
