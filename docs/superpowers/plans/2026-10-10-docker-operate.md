# Docker operate (часть 4 MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пять эндпоинтов раздела «4. Docker operate» — список контейнеров, детали, логи, нагрузка и restart контейнера на подключённом сервере — так, чтобы «упавший контейнер и его логи» были видны из панели, без ручного SSH.

**Architecture:** Docker API читается и вызывается библиотекой `dockerode`, но транспорт — наш: `dockerode` получаетнаш собственный `http.Agent`, который поднимает **одно** SSH-соединение на время HTTP-запроса панели и отдаёт каждому вызову Docker API отдельный exec-канал `docker system dial-stdio`. Агент живёт в шве `SshRunner` (там же, где `exec`), поэтому политика адресов, пин host key и классификация сбоев остаются единственными для обоих транспортов. В БД новых таблиц нет: скоупинг и роли — через `ServersService.loadForSsh`.

**Tech Stack:** NestJS 11, Prisma 6.19.3 (без миграций), `dockerode` 5.0.1 / `docker-modem` 5.0.7, `ssh2` 1.17 (напрямую, без node-ssh — нужен exec-канал как сокет), jest + ts-jest (живой PG), in-process `ssh2.Server` фикстура, `http.Server` как мок Docker API.

**Spec:** `docs/mvp-scope.md` — раздел «### 4. Docker operate (5)» и DoD; форма URL — `API.md:43-53`. Метрика спринта: `упавший контейнер и логи видны без SSH`.

## Global Constraints

- Node 26.7.0, npm 11.19.0; ветка `dev` (не `main`); `npm run build` зелёный после каждой задачи; коммит в конце каждой задачи; **не пушим**.
- В этом рабочем дереве параллельно правятся `src/modules/auth/**` и `src/modules/users/**` — в `git add` только свои файлы, `git add -A` запрещён.
- DoD из `docs/mvp-scope.md`: «Endpoint + Prisma-модель + guard/workspace-scoping + e2e через куки `access_token`, без заглушек `→null/[]`». Части 4 новых моделей не требуется — `Server` из части 3 достаточно; stub `DockerService.findContainers` (`return []`, `src/modules/servers/docker/docker.service.ts:5-9`) обязан быть удалён, а не дополнен.
- Из скоупа части 4 исключено (и не реализывается «на будущее»): `exec`, `volumes`, `networks`, `images`, `events`, `env`, `history`, `resources`, `recreate`, `DELETE container` — это `API.md:46,51-62`, вне P0.
- Вся работа с Docker обязана проходить через `ServersService.loadForSsh(..., 'authenticated')`: неподтверждённый host key = `424 HOST_KEY_NOT_TRUSTED`, чужой сервер = `404` неотличим от «нет строки».
- Никаких `process.env` в модулях: новые настройки читаются только в `loadAppConfig` (`src/config/app.config.ts`) и приходят через `APP_CONFIG`.
- Формат ответов — наши DTO, а не сырой JSON демона: клиент не должен зависеть от версии Docker API.
- Секреты (SSH-креденшелы) не попадают ни в URL, ни в тело удалённой команды, ни в логи.

---

## Что уже измерено (не предположение, а прогон)

Спайк 2026-10-10 (`/tmp/bios-dockerode-spike/spike2.js`, sshd-контейнер alpine + `docker-cli` + смонтированный `/var/run/docker.sock`, dockerode 5.0.1 / docker-modem 5.0.7):

| Факт | Значение для плана |
|---|---|
| Встроенный SSH-транспорт modem (`protocol: 'ssh'`) непригоден: `host:'ssh://127.0.0.1'` → `getaddrinfo ENOTFOUND ssh://127.0.0.1`, без схемы → `Invalid port in url` (`modem.js:95` отдаёт хост со схемой в `ssh2` на `:270`) | Используем документированный **custom agent** (`docker-modem/README.md:37-41`, `modem.js:112` `this.agent = opts.agent`, `:182-183` `optionsf.agent = this.agent`) |
| Первый вызов: `version()` 49 мс, +1 SSH-коннект, +1 exec; шесть последующих вызовов: **+0 коннектов**, по одному exec-каналу | Одно SSH-соединение на HTTP-запрос панели; пула между запросами нет (Known gaps) |
| `hostVerifier` отваливает соединение на `level: 'handshake'` с `Host denied (verification failed)`, отпечаток при этом получен | Правило «проверка ключа до аутентификации» переносится в новый транспорт без изменений |
| `logs({stdout:true})` вернул `\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u000ehello-from-p4` | Логи мультиплексированы: без `modem.demuxStream` в ответ попадут 8-байтовые заголовки |
| `stats({stream:false})` = **1064 мс** | Это не «быстрый замер», а две точки внутри одного вызова; endpoint обязан это учитывать (timeout ≥ 2×`commandTimeoutMs`) |
| `stream.destroy()` при `follow: true` даёт событие `close`, а не `end` | Стриминг логов (SSE) — вне этой задачи; snapshot-логи обязаны завершаться и по `close`, и по `end` |
| Не проверено спайком: `restart()` (процесс умер до него) | Закрывается живым smoke в Task 6 |

---

## File Structure

Создаётся:

- `src/modules/servers/ssh/docker-agent.ts` — единственный код, который знает, как из `SshSession` получить `http.Agent` поверх одного ssh2-коннекта. (~110 строк)
- `src/modules/servers/ssh/docker-agent.spec.ts` — юнит-тесты агента против мока Docker API (без SSH).
- `src/modules/servers/docker/docker.service.ts` — переписывается с нуля (5 методов + маппинг + лимиты).
- `src/modules/servers/docker/docker-readiness.ts` — классификация сбоя `docker system dial-stdio` в `SshErrorCode` (отдельный файл, потому что это чистая функция над stderr/кодом и её надо тестировать изолированно).
- `src/modules/servers/docker/dto/container-ids.dto.ts`, `src/modules/servers/docker/dto/container-action.dto.ts`, `src/modules/servers/docker/dto/container-log-query.dto.ts` — DTO с валидацией.
- `src/modules/servers/docker/container.types.ts` — ответы (`ContainerSummary`, `ContainerDetails`, `ContainerLogs`, `ContainerStats`, `ContainerActionResponse`).
- `src/modules/servers/docker/docker.service.spec.ts`, `docker-readiness.spec.ts`, `dto/dto.spec.ts` — тесты.
- `test/docker-operate.e2e-spec.ts` — e2e пяти роутов.

Изменяется:

- `src/modules/servers/ssh/ssh-runner.ts` — `SshRunner.dockerTransport()`, `DockerTransport`, новые `SshErrorCode`.
- `src/modules/servers/ssh/node-ssh.runner.ts` — общий `connectConfig()` + `dockerTransport()`.
- `src/modules/servers/ssh/fake-ssh.runner.ts` — `dockerTransport()` через мок Docker API + запись запросов.
- `src/modules/servers/ssh/testing/ssh-server-fixture.ts` — опция `dialStdioPort`: exec-канал `docker system dial-stdio` трубит в локальный мок.
- `src/modules/servers/servers.service.ts` — `loadForSsh` из private в public.
- `src/modules/servers/docker/docker.controller.ts`, `docker.module.ts` — пять роутов, guard, профили, провайдер `SSH_RUNNER`.
- `src/config/app.config.ts` + `app.config.spec.ts` — `docker.logsMaxBytes`, `docker.statsTimeoutMs`, троттл-профиль `dockerReads`.
- `src/common/throttle/throttle-options.factory.ts` + `throttle-profiles.spec.ts` — шестой именованный throttler.

---

## Task 0: Зависимость и baseline

**Files:**
- Modify: `app/backend/package.json`, `app/backend/package-lock.json`

**Interfaces:**
- Consumes: ничего.
- Produces: `dockerode` в `dependencies`, `@types/dockerode` в `devDependencies`; дальнейшие задачи импортируют `import Docker from 'dockerode'` и тип `import type Dockerode from 'dockerode'`.

- [ ] **Step 1: Зафиксировать текущее состояние**

```bash
cd app/backend && git status --short && npx jest 2>&1 | grep -E '^(Test Suites|Tests)'
```

Expected: 21 suite / 187 тестов PASS. Если нет — разбор до начала работы (в дереве параллельная правка `auth/**`).

- [ ] **Step 2: Установить ровно те версии, что проверены спайком**

```bash
cd app/backend && npm i dockerode@5.0.1 && npm i -D @types/dockerode
node -e "const p=require('./package.json');console.log(p.dependencies.dockerode, p.devDependencies['@types/dockerode'])"
```

Expected: `5.0.1` и версия типов. Если npm тянет `docker-modem` другой мажорной версии — проверить, что `node_modules/docker-modem/lib/modem.js` всё ещё содержит `this.agent = opts.agent` (строка ~112) и `optionsf.agent = this.agent` (~182); на этих двух строках держится весь транспорт.

- [ ] **Step 3: Проверить, что «сырая» зависимость не ломает сборку**

```bash
cd app/backend && npm run build && npx jest src/modules/servers 2>&1 | grep -E '^(Test Suites|Tests)'
```

Expected: сборка без ошибок, серверные тесты зелёные.

- [ ] **Step 4: Коммит**

```bash
git add app/backend/package.json app/backend/package-lock.json
git commit -m "build(backend): add dockerode for docker api transport"
```

---

## Task 1: `dockerTransport` в шве SSH

**Files:**
- Create: `src/modules/servers/ssh/docker-agent.ts`, `src/modules/servers/ssh/docker-agent.spec.ts`
- Modify: `src/modules/servers/ssh/ssh-runner.ts` (интерфейс + коды ошибок), `src/modules/servers/ssh/node-ssh.runner.ts` (общий `connectConfig`, `dockerTransport`), `src/modules/servers/ssh/fake-ssh.runner.ts`, `src/modules/servers/servers.service.ts` (`loadForSsh` → public)

**Interfaces:**
- Consumes: `SshSession` (`ssh-runner.ts:41-51`), `hostKeyFingerprint` (`ssh/host-key.ts`), `classifySshError` (`ssh/classify-ssh-error.ts`).
- Produces (это контракт, на него опираются Task 2–6, имена менять нельзя):

```ts
// ssh-runner.ts
export interface DockerTransport {
  readonly agent: http.Agent;
  close(): void;
}

export interface SshRunner {
  exec(session: SshSession, command: string, timeoutMs: number): Promise<SshExecResult>;
  /** Один SSH-коннект под много Docker API-вызовов. close() обязателен в finally. */
  dockerTransport(session: SshSession, timeoutMs: number): Promise<DockerTransport>;
}

// новые члены SshErrorCode:
| 'DOCKER_UNREACHABLE' | 'DOCKER_API_FAILED'
```

```ts
// docker-agent.ts
export const DOCKER_DIAL_COMMAND = 'docker system dial-stdio';
export function createDockerAgent(
  conn: Client,
  onChannelError: (err: unknown) => void,
): http.Agent;
export class DockerSshTransport implements DockerTransport {
  constructor(agent: http.Agent, conn: Client);
  readonly agent: http.Agent;
  close(): void;
}
```

- [ ] **Step 1: Падающий юнит-тест агента (без SSH — мокаем `Client`)**

Create `src/modules/servers/ssh/docker-agent.spec.ts`:

```ts
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { createDockerAgent, DOCKER_DIAL_COMMAND } from './docker-agent';

/** Мок ssh2.Client: exec('docker system dial-stdio') отдаёт наш канал. */
function fakeClient(
  execImpl: (
    cmd: string,
    cb: (err: Error | null, stream?: PassThrough) => void,
  ) => void,
) {
  return { exec: execImpl } as unknown as Parameters<typeof createDockerAgent>[0];
}

function channelPair() {
  const toDocker = new PassThrough();
  const fromDocker = new PassThrough();
  const channel = new PassThrough();
  channel.pipe(toDocker);
  fromDocker.pipe(channel);
  return { channel, toDocker, fromDocker };
}

test('createConnection открывает exec-канал docker system dial-stdio', async () => {
  const commands: string[] = [];
  const { channel } = channelPair();
  const agent = createDockerAgent(
    fakeClient((cmd, cb) => {
      commands.push(cmd);
      cb(null, channel);
    }),
    () => undefined,
  );
  await new Promise<void>((resolve, reject) => {
    agent.createConnection({}, (err, socket) =>
      err ? reject(err) : (socket.destroy(), resolve()),
    );
  });
  expect(commands).toEqual([DOCKER_DIAL_COMMAND]);
});

test('ошибка exec уходит в onChannelError, а не висит', async () => {
  const seen: unknown[] = [];
  const agent = createDockerAgent(
    fakeClient((_cmd, cb) => cb(new Error('exec failed'))),
    (err) => seen.push(err),
  );
  await new Promise((resolve) =>
    agent.createConnection({}, (err) => resolve(err)),
  );
  expect(seen).toHaveLength(1);
  expect((seen[0] as Error).message).toBe('exec failed');
});

test('close() уничтожает агента: повторный запрос не получает новый канал', async () => {
  let execs = 0;
  const { channel } = channelPair();
  const agent = createDockerAgent(
    fakeClient((_c, cb) => {
      execs += 1;
      cb(null, channel);
    }),
    () => undefined,
  );
  agent.destroy();
  expect(execs).toBe(0);
});
```

Run: `npx jest src/modules/servers/ssh/docker-agent.spec.ts` → FAIL «Cannot find module './docker-agent'».

- [ ] **Step 2: Реализовать `docker-agent.ts`**

```ts
import http from 'node:http';
import type { Client, Channel } from 'ssh2';

export const DOCKER_DIAL_COMMAND = 'docker system dial-stdio';

/**
 * http.Agent поверх ОДНОГО ssh2-соединения: каждый Docker API-вызов = новый
 * exec-канал `docker system dial-stdio`, соединение не пересоздаётся.
 * Именно так подключается docker CLI к `ssh://` эндпоинту; docker-modem
 * умеет принимать такой агент (`modem.js:112`, `:182`).
 */
export function createDockerAgent(
  conn: Client,
  onChannelError: (err: unknown) => void,
): http.Agent {
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = (_options, callback) => {
    conn.exec(DOCKER_DIAL_COMMAND, (err, stream) => {
      if (err || !stream) {
        onChannelError(err ?? new Error('no exec channel for docker api'));
        callback(err ?? new Error('no exec channel for docker api'));
        return;
      }
      const channel = stream as Channel;
      channel.on('error', onChannelError);
      callback(null, channel as unknown as import('node:stream').Duplex);
    });
  };
  return agent;
}
```

- [ ] **Step 3: Прогнать — зелёные оба теста**

Run: `npx jest src/modules/servers/ssh/docker-agent.spec.ts`. Expected: 2 PASS.

- [ ] **Step 4: Тест реального транспорта против ssh2-фикстуры (SSH + пин + один коннект на много вызовов)**

Modify `src/modules/servers/ssh/testing/ssh-server-fixture.ts`: в `FixtureOptions` добавить

```ts
  /**
   * Порт локального мока Docker API: exec-канал `docker system dial-stdio`
   * трубится в него в обе стороны — тест получает настоящий HTTP поверх
   * настоящего SSH без демона.
   */
  dialStdioPort?: number;
```

в обработчик `session.on('exec', ...)` (сейчас `:92-97`) — ветку **до** обычной записи stdout:

```ts
        if (options.dialStdioPort && info.command === 'docker system dial-stdio') {
          const tcp = net.connect(options.dialStdioPort, '127.0.0.1', () => {
            stream.pipe(tcp).pipe(stream);
          });
          tcp.on('error', () => stream.close());
          return;
        }
```

(`import net from 'node:net'` в начало файла.)

Create `src/modules/servers/ssh/node-ssh.docker-transport.spec.ts`:

```ts
import http from 'node:http';
import { NodeSshRunner } from './node-ssh.runner';
import { SshFailure, type SshSession } from './ssh-runner';
import { hostKeyFingerprint } from './host-key';
import { startSshFixture } from './testing/ssh-server-fixture';
import { testAppConfig } from '../../../config/testing/app-config.fixture';

function dockerMock(): { server: http.Server; port: Promise<number>; hits: string[] } {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    res.end(
      req.url?.startsWith('/version')
        ? JSON.stringify({ ApiVersion: '1.51', Version: 'mock-1.2.3' })
        : JSON.stringify([]),
    );
  });
  const port = new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    }),
  );
  return { server, port, hits };
}

function session(pin: string | null): SshSession {
  return {
    host: '127.0.0.1',
    address: '127.0.0.1',
    port: 0,
    username: 'root',
    authType: 'PASSWORD',
    secret: 'sup3rsecret',
    expectedHostKeyFingerprint: pin,
  };
}

test('один SSH-коннект обслуживает несколько Docker API-вызовов', async () => {
  const mock = dockerMock();
  const port = await mock.port;
  const fx = await startSshFixture({
    password: 'sup3rsecret',
    dialStdioPort: port,
  });
  const runner = new NodeSshRunner(testAppConfig({ sshPort: fx.port }));
  const transport = await runner.dockerTransport(session(fx.hostKey()), 8000);
  try {
    const call = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          { agent: transport.agent, host: '127.0.0.1', port: 1, path },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await call('/version')).toBe(200);
    expect(await call('/containers/json')).toBe(200);
    expect(await call('/containers/json')).toBe(200);
  } finally {
    transport.close();
    await new Promise((r) => mock.server.close(r));
    await fx.close();
  }
});

test('без принятого пина транспорт падает до аутентификации', async () => {
  const mock = dockerMock();
  const port = await mock.port;
  const fx = await startSshFixture({ password: 'sup3rsecret', dialStdioPort: port });
  const runner = new NodeSshRunner(testAppConfig({ sshPort: fx.port }));
  await expect(runner.dockerTransport(session(null), 8000)).rejects.toBeInstanceOf(
    SshFailure,
  );
  await new Promise((r) => mock.server.close(r));
  await fx.close();
});
```

Run: `npx jest src/modules/servers/ssh/node-ssh.docker-transport.spec.ts` → FAIL (нет метода `dockerTransport`).

- [ ] **Step 5: Реализовать `dockerTransport` в `NodeSshRunner`**

Вынести конфиг подключения из `exec` (иначе правило «верификатор до аутентификации» продублируется и разъедется):

```ts
  private connectConfig(
    session: SshSession,
    state: { observed: string | null; rejectedByPolicy: boolean },
  ): Config & { hostVerifier: (key: Buffer | string) => boolean } {
    return {
      host: session.address,
      port: session.port,
      username: session.username,
      readyTimeout: this.cfg.ssh.connectTimeoutMs,
      // tryKeyboard НЕ ставим: обработчика keyboard-interactive нет (ревью №10).
      hostVerifier: (key: Buffer | string): boolean => {
        state.observed = hostKeyFingerprint(
          Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex'),
        );
        if (
          session.expectedHostKeyFingerprint === null ||
          state.observed !== session.expectedHostKeyFingerprint
        ) {
          state.rejectedByPolicy = true; // креденшелы не отправятся: верификатор валит KEX
          return false;
        }
        return true;
      },
      ...(session.authType === 'PASSWORD'
        ? { password: session.secret }
        : { privateKey: session.secret }),
    };
  }
```

`exec` использует `this.connectConfig(session, state)` вместо инлайн-объекта (поведение не меняется — существующие тесты `node-ssh.runner.spec.ts` должны остаться зелёными), и новый метод:

```ts
  async dockerTransport(
    session: SshSession,
    timeoutMs: number,
  ): Promise<DockerTransport> {
    const conn = new Client();
    const state: { observed: string | null; rejectedByPolicy: boolean } = {
      observed: null,
      rejectedByPolicy: false,
    };
    let ready: (() => void) | null = null;
    let failed: ((err: Error) => void) | null = null;
    const settled = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = (err) =>
        reject(
          state.rejectedByPolicy
            ? this.policyFailure(session, state.observed)
            : new SshFailure(classifySshError(err), 'ssh transport failure'),
        );
    });
    conn.on('ready', () => ready?.());
    conn.on('error', (err) => failed?.(err));

    const guard = setTimeout(
      () => failed?.(new SshFailure('TIMEOUT', 'docker transport timed out')),
      timeoutMs,
    );
    guard.unref();
    try {
      conn.connect(this.connectConfig(session, state));
      await settled;
      const agent = createDockerAgent(conn, () => undefined);
      return { agent, close: () => { conn.end(); agent.destroy(); } };
    } catch (err) {
      conn.end();
      if (err instanceof SshFailure) throw err;
      throw new SshFailure(classifySshError(err), 'ssh transport failure');
    } finally {
      clearTimeout(guard);
    }
  }
```

(`import { Client } from 'ssh2'` и `import { createDockerAgent } from './docker-agent'`; `Config` уже импортирован из `node-ssh`.)

- [ ] **Step 6: Реализовать двойник в `FakeSshRunner`**

Двойник поднимает `http.Server` на loopback и отдаёт скриптованные ответы — тогда `DockerService` тестируется с настоящей `dockerode`, но без демона и без SSH. Контракт:

```ts
  /** Пути Docker API, которые двойник реально получил (порядок важен). */
  readonly dockerRequests: string[] = [];
  /** Ответ на GET/POST path: value — JSON тела; 404, если ключа нет. */
  dockerRoutes: Record<string, unknown>;

  async dockerTransport(session: SshSession): Promise<DockerTransport> {
    this.sessions.push(session);
    if (session.expectedHostKeyFingerprint === null) {
      throw new SshFailure(
        'HOST_KEY_NOT_TRUSTED',
        'host key is not trusted yet',
      );
    }
    const server = http.createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      this.dockerRequests.push(`${req.method} ${path}`);
      const body = this.dockerRoutes[path];
      if (body === undefined) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'no such endpoint' }));
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (_o, cb) =>
      cb(null, net.connect(port, '127.0.0.1'));
    return {
      agent,
      close: () => {
        agent.destroy();
        server.close();
      },
    };
  }
```

`reset()` дополнить: `this.dockerRequests.length = 0; this.dockerRoutes = {};` (иначе ответы потечут в следующий тест — тот же класс ошибки, что чинили в части 3).

- [ ] **Step 7: `loadForSsh` — из private в public**

Modify `src/modules/servers/servers.service.ts`: сменить `private async loadForSsh(` на `async loadForSsh(`. Doc-комментарий над ним (`:327-331`) остаётся; к нему добавить строку:

```
   * Публичный: DockerService обязан проходить те же guard/политику/пин, что и test/install.
```

- [ ] **Step 8: Все серверные тесты + сборка**

```bash
cd app/backend && npx jest src/modules/servers 2>&1 | grep -E '^(Tests|Test Suites|FAIL)' && npm run build
```

Expected: PASS, сборка чистая (в том числе `servers.spec.ts`, где `FakeSshRunner` теперь обязан реализовать новый метод интерфейса — TS не даст пропустить).

- [ ] **Step 9: prettier/eslint + коммит**

```bash
npx prettier --write "src/modules/servers/**/*.ts" && npx eslint src/modules/servers && git add app/backend/src/modules/servers app/backend/src/modules/servers/ssh
git commit -m "feat(backend): docker api transport over a single pinned ssh connection"
```

---

## Task 2: `DockerService` — список и детали

**Files:**
- Create: `src/modules/servers/docker/container.types.ts`, `src/modules/servers/docker/docker-readiness.ts`, `src/modules/servers/docker/docker-readiness.spec.ts`, `src/modules/servers/docker/dto/container-ids.dto.ts`, `src/modules/servers/docker/dto/dto.spec.ts`, `src/modules/servers/docker/docker.service.spec.ts`
- Rewrite: `src/modules/servers/docker/docker.service.ts`
- Modify: `src/modules/servers/docker/docker.module.ts`

**Interfaces:**
- Consumes: `ServersService.loadForSsh(userId, workspaceId, serverId, roles, 'authenticated') → Promise<{ server: Server; session: SshSession }>` (Task 1), `SSH_RUNNER` + `SshRunner.dockerTransport` (Task 1), `APP_CONFIG`.
- Produces:

```ts
// container.types.ts
export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  startedAt: string;
  exitCode: number | null;
}
export interface ContainerDetails extends ContainerSummary {
  command: string;
  createdAt: string;
  restartCount: number;
  oomKilled: boolean;
  health: 'NONE' | 'HEALTHY' | 'UNHEALTHY' | 'STARTING';
  ports: Array<{ ip: string; privatePort: number; publicPort: number; type: string }>;
  labels: Record<string, string>;
}
export type ContainersList = ContainerSummary[];

// docker.service.ts — сигнатуры, их зовёт контроллер (Task 5)
list(userId: string, workspaceId: string, serverId: string, all: boolean): Promise<ContainerSummary[]>;
details(userId: string, workspaceId: string, serverId: string, containerId: string): Promise<ContainerDetails>;
```

- [ ] **Step 1: Тест на валидацию id контейнера (падающий)**

Create `src/modules/servers/docker/dto/dto.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContainerIdsDto } from './container-ids.dto';

/** Настоящие UUIDv7: иначе падения будут от наследуемых @IsUUID('7'), а не от нашего правила. */
const WS = '01a1234a-1b54-77a1-a741-efc2cf92d024';
const SRV = '01a1234a-1b77-7631-8ed5-e483aebbe64f';

function invalidProps(value: Record<string, unknown>): string[] {
  const dto = plainToInstance(ContainerIdsDto, value);
  return validateSync(dto, { whitelist: true }).map((e) => e.property);
}

test('containerId: допустимые формы (id и имя)', () => {
  expect(invalidProps({ workspaceId: WS, serverId: SRV, containerId: 'a1b2c3d4' })).toEqual([]);
  expect(invalidProps({ workspaceId: WS, serverId: SRV, containerId: 'my-app_1.2' })).toEqual([]);
});

test('containerId: слэш, точка-точка, пробел и длина > 128 отклоняются', () => {
  for (const bad of ['..%2fcontainers', 'a/b', '../../etc', '', ' x', 'x'.repeat(129)]) {
    expect(invalidProps({ workspaceId: WS, serverId: SRV, containerId: bad })).toContain(
      'containerId',
    );
  }
});
```

Run: `npx jest src/modules/servers/docker/dto/dto.spec.ts` → FAIL (нет модуля).

- [ ] **Step 2: DTO**

Create `src/modules/servers/docker/dto/container-ids.dto.ts`:

```ts
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ServerIdsDto } from '../../dto/server-ids.dto';

/**
 * Docker принимает id ИМЯ контейнера. Имя идёт в путь Docker API, поэтому
 * правила строгие: первый символ — буква/цифра, дальше [-_.], длина ≤ 128.
 * Это отсекает и `%2f`, и `../`-апгрейд пути внутри API-вызова.
 */
export const CONTAINER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Наследует @IsUUID('7') на workspaceId и serverId (см. dto/server-ids.dto.ts:3-9). */
export class ContainerIdsDto extends ServerIdsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(CONTAINER_ID_RE, {
    message: 'containerId must be a docker container id or name',
  })
  containerId!: string;
}
```

- [ ] **Step 3: Прогнать DTO-тест**

Run: `npx jest src/modules/servers/docker/dto/dto.spec.ts`. Expected: PASS (2 теста). Если `MaxLength` ругается на 129-символьную строку раньше `Matches` — оба дают ошибку по `containerId`, тест это принимает.

- [ ] **Step 4: Классификация недоступности Docker (падающий тест)**

Create `src/modules/servers/docker/docker-readiness.spec.ts`:

```ts
import { classifyDialFailure } from './docker-readiness';

test('нет бинарника docker — DOCKER_MISSING', () => {
  expect(
    classifyDialFailure('sh: docker: not found', 'exec fail'),
  ).toBe('DOCKER_MISSING');
  expect(
    classifyDialFailure('bash: docker: command not found', ''),
  ).toBe('DOCKER_MISSING');
});

test('нет прав на сокет — DOCKER_PERMISSION_DENIED', () => {
  expect(
    classifyDialFailure(
      'permission denied while trying to connect to the Docker daemon socket',
      '',
    ),
  ).toBe('DOCKER_PERMISSION_DENIED');
});

test('демон молчит — DOCKER_SOCKET_UNREACHABLE', () => {
  expect(
    classifyDialFailure(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
      '',
    ),
  ).toBe('DOCKER_SOCKET_UNREACHABLE');
});

test('непонятный вывод — DOCKER_UNREACHABLE, а не «команда упала»', () => {
  expect(classifyDialFailure('some daemon error', 'exit 1')).toBe(
    'DOCKER_UNREACHABLE',
  );
});
```

Run → FAIL (нет модуля).

- [ ] **Step 5: Реализовать классификатор**

Create `src/modules/servers/docker/docker-readiness.ts`:

```ts
import type { SshErrorCode } from '../ssh/ssh-runner';

/**
 * `docker system dial-stdio` — единственная команда, которую мы отправляем в
 * этом модуле; её stderr и есть диагноз «Docker недоступен». Тот же набор
 * сообщений, что в `classifyDockerFailure` (часть 3), но вход — текст, а не
 * код возврата exec'а.
 */
export function classifyDialFailure(stderr: string, observed: string): SshErrorCode {
  const text = `${stderr} ${observed}`.toLowerCase();
  if (text.includes('command not found') || text.includes('docker: not found')) {
    return 'DOCKER_MISSING';
  }
  if (text.includes('permission denied')) return 'DOCKER_PERMISSION_DENIED';
  if (text.includes('cannot connect to the docker daemon')) {
    return 'DOCKER_SOCKET_UNREACHABLE';
  }
  return 'DOCKER_UNREACHABLE';
}
```

Run: `npx jest src/modules/servers/docker/docker-readiness.spec.ts`. Expected: 4 PASS.

- [ ] **Step 6: Тесты сервиса: список, детали, скоупинг, ошибки**

Create `src/modules/servers/docker/docker.service.spec.ts`. Каркас и хелперы (`testAppConfig`, `dtoFor`, `trustedServer`, `pin`) — **те же, что в `src/modules/servers/servers.spec.ts:1-120`**, скопировать дословно (тот же паттерн: реальный `PrismaService` к `bios_test_servers`, `FakeSshRunner`, `CredentialCryptoService`). Дальше:

```ts
const RUNNING = [
  {
    Id: 'aaaa1111',
    Names: ['/web'],
    Image: 'nginx:1.27',
    ImageID: 'sha256:x',
    State: 'running',
    Status: 'Up 2 hours',
    Created: 1700000000,
    Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
    Labels: { 'bios.project': 'shop' },
  },
  {
    Id: 'bbbb2222',
    Names: ['/worker'],
    Image: 'alpine:3.20',
    State: 'exited',
    Status: 'Exited (1) 5 minutes ago',
    Created: 1700000100,
    Ports: [],
    Labels: {},
  },
];

test('список: id, имя, образ, состояние, код выхода из Status', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRoutes['/containers/json'] = RUNNING;
  const list = await docker.list(ownerId, workspaceId, serverId, true);
  expect(list).toHaveLength(2);
  expect(list[0]).toEqual({
    id: 'aaaa1111',
    name: 'web',
    image: 'nginx:1.27',
    state: 'running',
    status: 'Up 2 hours',
    startedAt: new Date(1700000000 * 1000).toISOString(),
    exitCode: null,
  });
  expect(list[1].exitCode).toBe(1); // «Exited (1) 5 minutes ago»
  expect(ssh.dockerRequests[0]).toBe('GET /containers/json');
});

test('all=false добавляет ?all=0 и не скрывает запущенные', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRoutes['/containers/json'] = RUNNING;
  await docker.list(ownerId, workspaceId, serverId, false);
  expect(ssh.dockerRequests[0]).toBe('GET /containers/json');
});

test('детали: health, restartCount, oomKilled, порты и labels', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRoutes['/containers/bbbb2222/json'] = {
    Id: 'bbbb2222',
    Name: '/worker',
    Config: { Image: 'alpine:3.20', Labels: { a: 'b' } },
    Created: '2026-10-01T00:00:00Z',
    State: {
      Status: 'exited', Running: false, StartedAt: '2026-10-01T00:00:00Z',
      ExitCode: 137, OOMKilled: true, RestartCount: 3,
      Health: { Status: 'starting' },
    },
    Config2: null,
    HostConfig: {},
    NetworkSettings: { Ports: { '8080/tcp': [{ HostPort: '9000' }] } },
  };
  const one = await docker.details(ownerId, workspaceId, serverId, 'bbbb2222');
  expect(one).toMatchObject({
    id: 'bbbb2222', name: 'worker', image: 'alpine:3.20',
    state: 'exited', exitCode: 137, oomKilled: true, restartCount: 3,
    health: 'STARTING', labels: { a: 'b' },
  });
});

test('несуществующий контейнер → 404, а не 500', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRoutes = {}; // любой путь → 404 от мока
  await expect(
    docker.details(ownerId, workspaceId, serverId, 'ghost'),
  ).rejects.toMatchObject({ status: 404 });
});

test('сервер без принятого host key → 424, в Docker не заходят', async () => {
  const { docker, ssh, ownerId, workspaceId, created } = await untrusted();
  await expect(
    docker.list(ownerId, workspaceId, created.id, true),
  ).rejects.toMatchObject({ status: 424 });
  expect(ssh.sessions).toHaveLength(0);
});

test('чужой сервер → 404 неотличим от «нет строки»', async () => {
  const { docker, ownerId, serverId } = await ready();
  const other = await extraUser();
  await expect(
    docker.list(other.id, other.workspaceId, serverId, true),
  ).rejects.toMatchObject({ status: 404 });
});

test('docker отсутствует на хосте → 424 DOCKER_MISSING (не 5xx)', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerDialFailure = 'sh: docker: not found';
  await expect(
    docker.list(ownerId, workspaceId, serverId, true),
  ).rejects.toMatchObject({
    status: 424,
    response: expect.objectContaining({ errorCode: 'DOCKER_MISSING' }),
  });
});
```

Хелпер `ready()` строит `DockerService` с подменённым `SSH_RUNNER` на `ssh` (тот же `Test.createTestingModule(...).useValue(SSH_RUNNER, ssh)` паттерн из `servers.spec.ts`), регистрирует `ssh.dockerRoutes` заранее, и возвращает `{ docker, ssh, ownerId, workspaceId, serverId }`. `docker` обязан вызывать `transport.close()` в `finally` — проверить это в следующем шаге.

Run: `npx jest src/modules/servers/docker` → FAIL (нет `docker.service.ts` с методами).

- [ ] **Step 7: Реализовать `DockerService` (только чтение списка/деталей)**

```ts
import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Dockerode from 'dockerode';
import {
  SSH_RUNNER,
  SshFailure,
  type DockerTransport,
  type SshRunner,
} from '../ssh/ssh-runner';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';
import { classifyDialFailure } from './docker-readiness';
import { ServersService, MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers.service';
import type { ContainerDetails, ContainerSummary } from './container.types';

const EXIT_CODE_RE = /Exited \((-?\d+)\)/;

@Injectable()
export class DockerService {
  constructor(
    private readonly servers: ServersService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Одна SSH-сессия = один Dockerode на время HTTP-запроса. Транспорт
   * обязан закрыться в finally, иначе ssh2-коннект переживёт запрос.
   */
  private async withDocker<T>(
    userId: string,
    workspaceId: string,
    serverId: string,
    fn: (docker: Dockerode) => Promise<T>,
  ): Promise<T> {
    const { session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      'authenticated',
    );
    let transport: DockerTransport;
    try {
      transport = await this.ssh.dockerTransport(session, this.timeoutMs());
    } catch (err) {
      if (err instanceof SshFailure) throw this.toHttp(err);
      throw err;
    }
    // host/port игнорируются: реальный транспорт — agent поверх SSH-канала.
    const docker = new Dockerode({
      host: 'http://127.0.0.1:1',
      agent: transport.agent,
    });
    try {
      return await fn(docker);
    } catch (err) {
      throw await this.mapDockerError(err, transport);
    } finally {
      transport.close();
    }
  }
```

`list`/`details` поверх него (полные тела — в задаче; здесь контракт):

```ts
  async list(userId: string, workspaceId: string, serverId: string, all: boolean): Promise<ContainerSummary[]> {
    return this.withDocker(userId, workspaceId, serverId, async (docker) => {
      const raw = await docker.listContainers({ all });
      return raw.map(toSummary);
    });
  }

  async details(userId: string, workspaceId: string, serverId: string, containerId: string): Promise<ContainerDetails> {
    return this.withDocker(userId, workspaceId, serverId, async (docker) =>
      toDetails(await docker.getContainer(containerId).inspect()),
    );
  }
```

`toSummary`/`toDetails` — чистые функции в `container.types.ts` рядом с типами: `name` = `Names[0].replace(/^\//, '')`, `startedAt` = `new Date(Created * 1000).toISOString()`, `exitCode` = `Number(EXIT_CODE_RE.exec(Status)?.[1] ?? (State === 'exited' ? 0 : null))` (для деталей приоритет на `State.ExitCode`), `health` — `'NONE'` при `Health.Status === 'none'`. `mapDockerError`: `statusCode === 404` → `NotFoundException('container not found')`; `SshFailure` → `toHttp`; остальное → `InternalServerErrorException('docker api call failed', { cause: err })` (ошибку транспорта НЕ выдаём за «контейнера нет»).

`toHttp(err: SshFailure)` = `FailedDependencyException` (уже есть в `src/common/http/`) с `errorCode` из ошибки; если это `DOCKER_UNREACHABLE`, предварительно прогнать текст канала через `classifyDialFailure`.

- [ ] **Step 8: Прогнать тесты**

Run: `npx jest src/modules/servers/docker`. Expected: все PASS; `ssh.dockerRequests` непустой там, где это заявлено.

- [ ] **Step 9: Модуль, сборка, линт, коммит**

Modify `src/modules/servers/docker/docker.module.ts`:

```ts
@Module({
  imports: [ServersModule],
  controllers: [DockerController],
  providers: [DockerService],
})
```

(`ServersModule` обязан экспортировать `ServersService` и `SSH_RUNNER` — добавить `exports: [ServersService, SSH_RUNNER]` в `servers.module.ts`, если их там нет; иначе два модуля разойдутся по разным экземплярам шва.)

```bash
cd app/backend && npm run build && npx eslint src/modules/servers && npx prettier --check "src/modules/servers/**/*.ts"
git add app/backend/src/modules/servers
git commit -m "feat(backend): docker container list and details over ssh transport"
```

---

## Task 3: Логи и нагрузка

**Files:**
- Create: `src/modules/servers/docker/dto/container-log-query.dto.ts`
- Modify: `src/modules/servers/docker/docker.service.ts`, `src/modules/servers/docker/container.types.ts`, `src/config/app.config.ts`, `src/config/app.config.spec.ts`, `src/modules/servers/docker/docker.service.spec.ts`

**Interfaces:**
- Consumes: `withDocker` (Task 2), `Dockerode.Container.modem.demuxStream`.
- Produces:

```ts
// docker.service.ts
logs(userId: string, workspaceId: string, serverId: string, containerId: string,
     q: ContainerLogQueryDto): Promise<ContainerLogs>;
stats(userId: string, workspaceId: string, serverId: string, containerId: string): Promise<ContainerStats>;

// container.types.ts
export interface ContainerLogs {
  containerId: string;
  lines: string[];
  truncated: boolean;
  limitBytes: number;
  timestamps: boolean;
}
export interface ContainerStats {
  containerId: string;
  readAt: string;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  blkReadBytes: number | null;
  blkWriteBytes: number | null;
}

// app.config.ts — cfg.docker
docker: { logsMaxBytes: number; statsTimeoutMs: number };
// env: DOCKER_LOGS_MAX_BYTES (default 262144), DOCKER_STATS_TIMEOUT_MS (default 15000)
```

- [ ] **Step 1: Конфиг — падающий тест**

В `src/config/app.config.spec.ts` добавить:

```ts
test('docker limits: значения по умолчанию и перегрузка env', () => {
  expect(loadAppConfig(baseEnv()).docker).toEqual({
    logsMaxBytes: 262144,
    statsTimeoutMs: 15000,
  });
  expect(
    loadAppConfig({ ...baseEnv(), DOCKER_LOGS_MAX_BYTES: '4096', DOCKER_STATS_TIMEOUT_MS: '30000' }).docker,
  ).toEqual({ logsMaxBytes: 4096, statsTimeoutMs: 30000 });
});

test('docker limits: ноль и мусор — fail-fast', () => {
  expect(() => loadAppConfig({ ...baseEnv(), DOCKER_LOGS_MAX_BYTES: '0' })).toThrow(
    /DOCKER_LOGS_MAX_BYTES must be between 1024 and 8388608/,
  );
  expect(() => loadAppConfig({ ...baseEnv(), DOCKER_STATS_TIMEOUT_MS: 'x' })).toThrow(
    /DOCKER_STATS_TIMEOUT_MS must be an integer between 1000 and 120000/,
  );
});
```

Run → FAIL.

- [ ] **Step 2: Реализовать секцию `docker` в `loadAppConfig`**

```ts
  const docker = {
    logsMaxBytes: parseIntegerInRange(
      env,
      'DOCKER_LOGS_MAX_BYTES',
      262144,
      1024,
      8388608,
    ),
    statsTimeoutMs: parseIntegerInRange(
      env,
      'DOCKER_STATS_TIMEOUT_MS',
      15000,
      1000,
      120000,
    ),
  };
```

в `AppConfig` добавить `readonly docker: { logsMaxBytes: number; statsTimeoutMs: number };` и вернуть его из `loadAppConfig` рядом с `ssh`. Если `parseIntegerInRange` в файле нет — завести его рядом с `parseThrottle` по тому же образцу (ошибки в верхнем регистре имени переменной, как у существующих парсеров).

Run: `npx jest src/config` → PASS.

- [ ] **Step 3: Тест логов (мультиплексирование, хвост, обрезка)**

Add to `docker.service.spec.ts`:

```ts
function frame(stream: 1 | 2, text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt8(stream, 0);
  out.writeUInt32BE(body.length, 4);
  body.copy(out, 8);
  return out;
}

test('логи: stdout и stderr разделяются, порядок сохраняется', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRawBodies['GET /containers/web/logs'] = Buffer.concat([
    frame(1, 'out-1\n'),
    frame(2, 'err-1\n'),
    frame(1, 'out-2\n'),
  ]);
  const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {
    tail: 10,
    timestamps: false,
    since: undefined,
  });
  expect(logs.lines).toEqual(['out-1', 'err-1', 'out-2']);
  expect(logs.truncated).toBe(false);
});

test('логи: обрезка по лимиту байт помечает truncated', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRawBodies['GET /containers/web/logs'] = frame(1, 'x'.repeat(4000) + '\n');
  ssh.cfgDockerLogsMaxBytes = 1024;
  const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {
    tail: 0, timestamps: false, since: undefined,
  });
  expect(logs.truncated).toBe(true);
  expect(logs.limitBytes).toBe(1024);
  expect(logs.lines.join('').length).toBeLessThanOrEqual(1024);
});

test('логи: tail=0 на стороне демона, хвост считаем сами; запрос содержит tail', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRawBodies['GET /containers/web/logs'] = frame(1, 'a\nb\nc\n');
  await docker.logs(ownerId, workspaceId, serverId, 'web', {
    tail: 2, timestamps: false, since: undefined,
  });
  expect(ssh.dockerRequests.some((r) => r.startsWith('GET /containers/web/logs'))).toBe(true);
  expect(ssh.dockerLastQuery).toMatchObject({ tail: '2' });
});
```

`FakeSshRunner` дополнить: `dockerRawBodies: Record<string, Buffer>` (отдаёт тело как есть, с заголовком `content-type: application/octet-stream`) и `dockerLastQuery: Record<string, string>` (query последней строки запроса).

Run → FAIL.

- [ ] **Step 4: Реализовать `logs` + DTO**

Create `src/modules/servers/docker/dto/container-log-query.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ContainerLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  tail?: number;

  @IsOptional()
  @IsBooleanString()
  timestamps?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;
}
```

`logs()` в сервисе:

```ts
  async logs(
    userId: string,
    workspaceId: string,
    serverId: string,
    containerId: string,
    q: ContainerLogQueryDto,
  ): Promise<ContainerLogs> {
    const limit = this.cfg.docker.logsMaxBytes;
    const tail = q.tail ?? 200;
    return this.withDocker(userId, workspaceId, serverId, async (docker) => {
      const container = docker.getContainer(containerId);
      const stream = (await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail,
        timestamps: q.timestamps === 'true',
        ...(q.since ? { since: q.since } : {}),
      })) as unknown as NodeJS.ReadableStream;
      const { stdout, stderr, truncated } = await demuxBounded(
        container,
        stream,
        limit,
      );
      const merged = mergeStreams(stdout, stderr, tail);
      return {
        containerId,
        lines: merged.lines,
        truncated: truncated || merged.truncated,
        limitBytes: limit,
        timestamps: q.timestamps === 'true',
      };
    });
  }
```

`demuxBounded` (в `container.types.ts`, рядом с мапперами — это про формат ответа):

```ts
/**
 * Docker отдаёт логи мультиплексированными фреймами (проверено живым прогоном:
 * \u0001 + 7 байт заголовка). demuxStream их разкладывает; свой лимит ставим
 * здесь, потому что жадный read().() съел бы память панели.
 */
export async function demuxBounded(
  container: Dockerode.Container,
  stream: NodeJS.ReadableStream,
  limitBytes: number,
): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  const out = new ChunkCapped(limitBytes);
  const err = new ChunkCapped(limitBytes);
  container.modem.demuxStream(stream, out, err);
  let total = 0;
  let truncated = false;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += (chunk as Buffer).length;
    if (total > limitBytes * 2) {
      truncated = true;
      break;
    }
  }
  stream.destroy();
  return { stdout: out.text(), stderr: err.text(), truncated: truncated || out.dropped || err.dropped };
}
```

`ChunkCapped` — `Writable`-накопитель на `node:stream.Writable` с отсечкой по байтам и флагом `dropped`. `mergeStreams` склеивает stdout+stderr и оставляет последние `tail` строк (сортировка по timestamp-префиксу не нужна: сервер уже отдаёт порядок фреймов).

Run: `npx jest src/modules/servers/docker -t 'логи'` → PASS.

- [ ] **Step 5: Тест stats (одна точка = две выборки) и реализация**

Add to `docker.service.spec.ts`:

```ts
test('stats: cpu% из дельты двух выборок, память и сеть из ответов демона', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRawBodies['GET /containers/web/stats'] = Buffer.from(
    JSON.stringify({
      read: '2026-10-10T00:00:00.000000000Z',
      cpu_stats: { cpu_usage: { total_usage: 2000 } },
      precpu_stats: { cpu_usage: { total_usage: 1000 } },
      // дельта хоста = 1000 на 2 CPU → (1000/1000)*2*100 = 200%?? нет: берём online_cpus=2 → 200
      system_cpu_usage: { total_usage: 1000, online_cpus: 2 },
      precpu_system_cpu_usage: { total_usage: 0 },
      memory_stats: { usage: 552960, limit: 1048576 },
      networks: { eth0: { rx_bytes: 111, tx_bytes: 222 } },
      blkio: {
        service_bytes_recursive: [
          { op: 'read', value: 7 },
          { op: 'write', value: 9 },
        ],
      },
    }),
  );
  const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
  expect(stats).toMatchObject({
    cpuPercent: 200,
    memoryUsageBytes: 552960,
    memoryLimitBytes: 1048576,
    netRxBytes: 111,
    netTxBytes: 222,
    blkReadBytes: 7,
    blkWriteBytes: 9,
  });
  expect(stats.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('stats: пустой ответ демона → нули, а не NaN', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRawBodies['GET /containers/web/stats'] = Buffer.from(
    JSON.stringify({ cpu_stats: {}, memory_stats: {} }),
  );
  const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
  expect(stats.cpuPercent).toBeNull();
  expect(Number.isNaN(stats.memoryUsageBytes as number)).toBe(false);
});
```

Реализация:

```ts
  async stats(
    userId: string,
    workspaceId: string,
    serverId: string,
    containerId: string,
  ): Promise<ContainerStats> {
    return this.withDocker(userId, workspaceId, serverId, async (docker) => {
      // stream:false — это ДВЕ выборки внутри одного вызова; прогон дал 1064 мс,
      // поэтому на транспорт вешаем cfg.docker.statsTimeoutMs, а не commandTimeoutMs.
      const raw = (await docker
        .getContainer(containerId)
        .stats({ stream: false })) as DockerStatsResponse;
      return toStats(containerId, raw);
    });
  }
```

`toStats` — чистая функция: `cpuDelta = cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage`, `sysDelta = system_cpu_usage.total_usage - precpu_system_cpu_usage.total_usage`, `cpuPercent = cpuDelta > 0 && sysDelta > 0 ? (cpuDelta / sysDelta) * (system_cpu_usage.online_cpus ?? 1) * 100 : null` (округление до 3 знаков), поля сети/блоков — `?? null` при отсутствии. `readAt` — `raw.read` в ISO (демон отдаёт nanoseconds — обрезать до миллисекунд регуляркой `/\.\d{9}Z$/ → 'Z'`).

Run: `npx jest src/modules/servers/docker -t 'stats'` → PASS.

- [ ] **Step 6: Таймаут транспорта по типу операции**

В `withDocker` заменить `this.timeoutMs()` на параметр `timeoutMs: number`, вызывающие методы передают `cfg.ssh.commandTimeoutMs` (list/details/logs) и `cfg.docker.statsTimeoutMs` (stats). Проверить, что `docker.stats` в тесте получает в `ssh.dockerTransportTimeouts` значение 15000: добавить в `FakeSshRunner` массив `transportTimeouts: number[]` и ассерт.

Run: `npx jest src/modules/servers/docker` → PASS.

- [ ] **Step 7: Сборка, линт, коммит**

```bash
cd app/backend && npm run build && npx eslint src/modules/servers src/config && npx prettier --write "src/modules/servers/**/*.ts" "src/config/**/*.ts"
git add app/backend/src/modules/servers app/backend/src/config
git commit -m "feat(backend): docker logs demux and one-shot stats with capped reads"
```

---

## Task 4: Restart (PATCH) и профили троттлинга

**Files:**
- Create: `src/modules/servers/docker/dto/container-action.dto.ts`
- Modify: `src/modules/servers/docker/docker.service.ts`, `docker.service.spec.ts`, `src/common/throttle/throttle-options.factory.ts`, `src/common/throttle/throttle-profiles.spec.ts`, `src/config/app.config.ts`, `src/config/app.config.spec.ts`, `src/modules/servers/dto/dto.spec.ts`

**Interfaces:**
- Consumes: `withDocker`, `OWNER_ONLY_ROLES` из `servers.service.ts` (ту же константу использует `agent/install` — проверить `grep -n 'OWNER_ONLY_ROLES' src/modules/servers`, список ролей в тесте зафиксировать).
- Produces:

```ts
// docker.service.ts
act(userId: string, workspaceId: string, serverId: string, containerId: string,
    dto: ContainerActionDto): Promise<ContainerActionResponse>;
// container.types.ts
export interface ContainerActionResponse {
  containerId: string;
  action: 'restart';
  state: string;
  status: string;
}
// app.config.ts → cfg.throttle.dockerReads = { limit: 60, ttlMs: 60000 } (env THROTTLE_DOCKER_READS)
```

- [ ] **Step 1: Тест действия (падающий)**

Add to `docker.service.spec.ts`:

```ts
test('restart: POST /restart c=1 и ответ из инспекта', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerRoutes['/containers/web/json'] = {
    Id: 'web', Name: '/web',
    Config: { Image: 'alpine' }, Created: '2026-10-10T00:00:00Z',
    State: { Status: 'running', Running: true, StartedAt: '2026-10-10T00:00:00Z', ExitCode: 0, Health: { Status: 'none' } },
  };
  const res = await docker.act(ownerId, workspaceId, serverId, 'web', { action: 'restart' });
  expect(res).toEqual({ containerId: 'web', action: 'restart', state: 'running', status: '' });
  expect(ssh.dockerRequests).toContain('POST /containers/web/restart');
  expect(ssh.dockerLastQuery).toMatchObject({ t: '1' });
});

test('restart останавливает не дольше timeoutMs и не ждёт вечно', async () => {
  const { docker, ssh, ownerId, workspaceId, serverId } = await ready();
  ssh.dockerHangPrefix = 'POST /containers/web/restart';
  await expect(
    docker.act(ownerId, workspaceId, serverId, 'web', { action: 'restart' }),
  ).rejects.toMatchObject({ status: 500 });
});

test('restart недоступен роль ниже OWNER', async () => {
  const { docker, workspaceId, serverId } = await ready();
  const member = await inviteAndAccept('docker-member@example.com');
  await expect(
    docker.act(member.id, workspaceId, serverId, 'web', { action: 'restart' }),
  ).rejects.toMatchObject({ status: 403 });
});
```

(`dockerHangPrefix` в `FakeSshRunner`: запрос по этому префиксу никогда не завершается — проверка, что таймаут навешан и на mutate.)

Run → FAIL.

- [ ] **Step 2: DTO действия**

Create `src/modules/servers/docker/dto/container-action.dto.ts`:

```ts
import { IsIn } from 'class-validator';

/**
 * Часть 4 принимает только restart. `recreate` из mvp-scope в P0 не входит:
 * он требует останов→переопределение→старт и ломает «упавший контейнер виден
 * без SSH» как метрику. Дыра в enum — это явный сигнал следующему, а не заглушка.
 */
export class ContainerActionDto {
  @IsIn(['restart'])
  action!: 'restart';
}
```

Add to `src/modules/servers/dto/dto.spec.ts`:

```ts
test('ContainerActionDto принимает только restart', async () => {
  const { ContainerActionDto } = await import('../docker/dto/container-action.dto');
  expect(validateFor(ContainerActionDto, { action: 'restart' })).toEqual([]);
  expect(validateFor(ContainerActionDto, { action: 'stop' })).toContain('action');
  expect(validateFor(ContainerActionDto, { action: 'recreate' })).toContain('action');
});
```

Run: `npx jest src/modules/servers/dto` → PASS.

- [ ] **Step 3: Реализовать `act`**

```ts
  async act(
    userId: string,
    workspaceId: string,
    serverId: string,
    containerId: string,
    dto: ContainerActionDto,
  ): Promise<ContainerActionResponse> {
    return this.withDocker(
      userId,
      workspaceId,
      serverId,
      async (docker) => {
        const container = docker.getContainer(containerId);
        await container.restart({ t: 1 });
        const after = await container.inspect();
        return {
          containerId,
          action: dto.action,
          state: after.State.Status,
          status: '',
        };
      },
      this.cfg.ssh.commandTimeoutMs,
      OWNER_ONLY_ROLES,
    );
  }
```

`withDocker` получает два необязательных аргумента (`timeoutMs`, `roles = MEMBER_ROLES`) и передаёт `roles` в `loadForSsh` — иначе restart станет доступен MEMBER’у по умолчанию.

Заменить заглушку `findContainers` в `docker.service.ts` на `list` (DoD: «без заглушек `→null/[]`»).

Run: `npx jest src/modules/servers/docker -t 'restart'` → PASS.

- [ ] **Step 4: Профиль `dockerReads`**

`app.config.ts`: в `throttle` добавить `dockerReads: parseThrottle(env, 'THROTTLE_DOCKER_READS', { limit: 60, ttlMs: 60000 })`; тип `AppConfig['throttle']` дополнить полем. `throttle-options.factory.ts`: строка `entry('dockerReads', cfg.throttle.dockerReads)` + `skipIf: skipUnless('dockerReads')` по образцу `sshOps` (`:57-58`). В `throttle-profiles.spec.ts` обновить ассерт «builds 5 named throttlers» на 6 и добавить `['dockerReads', 60, 60000]`.

Run: `npx jest src/config src/common/throttle` → PASS.

- [ ] **Step 5: Сборка, линт, коммит**

```bash
cd app/backend && npm run build && npx eslint src/modules/servers src/common/throttle src/config && npx prettier --write "src/**/*.ts"
git add app/backend/src
git commit -m "feat(backend): owner-only container restart with docker reads profile"
```

---

## Task 5: Роуты, guard и e2e

**Files:**
- Modify: `src/modules/servers/docker/docker.controller.ts`, `src/modules/servers/docker/dto/container-ids.dto.ts`
- Create: `test/docker-operate.e2e-spec.ts`

**Interfaces:**
- Consumes: `DockerService.list/details/logs/stats/act`, `JwtAuthGuard`, `ThrottleProfile`, DTO из Task 2–4.
- Produces: пять маршрутов под `workspaces/:workspaceId/servers/:serverId/docker` (базовый путь уже в файле, `docker.controller.ts:4`).

- [ ] **Step 1: Контроллер**

```ts
@Controller('workspaces/:workspaceId/servers/:serverId/docker')
@UseGuards(JwtAuthGuard)
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  @Get('containers')
  @ThrottleProfile('dockerReads')
  list(
    @User() user: JwtUserPayload,
    @Param() params: ServerScopeDto,
    @Query('all') all?: string,
  ) {
    return this.dockerService.list(
      user.userId,
      params.workspaceId,
      params.serverId,
      all === 'true',
    );
  }

  @Get('containers/:containerId')
  @ThrottleProfile('dockerReads')
  details(@User() user: JwtUserPayload, @Param() params: ContainerIdsDto) {
    return this.dockerService.details(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
    );
  }

  @Get('containers/:containerId/logs')
  @ThrottleProfile('dockerReads')
  logs(
    @User() user: JwtUserPayload,
    @Param() params: ContainerIdsDto,
    @Query() query: ContainerLogQueryDto,
  ) {
    return this.dockerService.logs(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
      query,
    );
  }

  @Get('containers/:containerId/stats')
  @ThrottleProfile('dockerReads')
  stats(@User() user: JwtUserPayload, @Param() params: ContainerIdsDto) {
    return this.dockerService.stats(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
    );
  }

  @Patch('containers/:containerId')
  @HttpCode(200)
  @ThrottleProfile('sshOps')
  act(
    @User() user: JwtUserPayload,
    @Param() params: ContainerIdsDto,
    @Body() dto: ContainerActionDto,
  ) {
    return this.dockerService.act(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
      dto,
    );
  }
}
```

`ServerScopeDto` — существующий DTO пути без `serverId`? Если такого нет (проверить `ls src/modules/servers/dto`), использовать `ServerIdsDto` и игнорировать `containerId` как необязательный: в `ServerIdsDto` есть только `workspaceId`/`serverId`, поэтому для `list` он и применяется.

- [ ] **Step 2: e2e (8+ тестов, паттерн `test/servers.e2e-spec.ts`)**

Create `test/docker-operate.e2e-spec.ts` с тем же заголовком (env до `require`, `INestApplication<App>`, `idOf`, `ssh.reset()` в `beforeEach`, FK-порядок в `afterEach`) и тестами:

1. `GET .../docker/containers` → 200, массив из 2, поля только наши (нет `ImageID`, `Platform`).
2. `GET .../docker/containers/:id` → 200 c `health`, `restartCount`.
3. `GET .../containers/:id/logs?tail=2` → 200, `lines` без байтов-заголовков (`expect(body.lines.join('')).not.toMatch(/\u0001/)`).
4. `GET .../containers/:id/stats` → 200, `cpuPercent` число ≥ 0, `memoryUsageBytes` = 552960.
5. `PATCH .../containers/:id` (OWNER) → 200 `{"action":"restart","state":"running"}`; тем же телом у MEMBER → 403.
6. `PATCH` с `{"action":"stop"}` → 400, в Docker не зашло (`ssh.dockerRequests` без `/restart`).
7. Непринятый host key → 424 `HOST_KEY_NOT_TRUSTED` для всех пяти методов.
8. Чужой `containerId` вида `../../etc/passwd` → 400; `%2e%2e/` → 400 (оба не доходят до транспорта).
9. Не-UUID `serverId` → 400.

Запуск: `npx jest --config test/jest-e2e.json test/docker-operate.e2e-spec.ts` → PASS.

- [ ] **Step 3: Полный прогон unit+e2e и коммит**

```bash
cd app/backend && npx jest && npx jest --config test/jest-e2e.json test/servers.e2e-spec.ts test/docker-operate.e2e-spec.ts && npm run build && npx prettier --check "src/**/*.ts" "test/**/*.ts"
git add app/backend/src/modules/servers app/backend/test
git commit -m "feat(backend): docker operate routes with per-profile throttling"
```

---

## Task 6: Живой smoke против контейнера с Docker

**Files:**
- Только временные артефакты в `/tmp`, ничего в репозитории.

- [ ] **Step 1: Поднять sshd с docker-cli и сокетом демона**

Тот же образ, что в части 3 (Dockerfile: alpine + `openssh` + `docker-cli`, root-пароль, `PermitRootLogin yes`):

```bash
mkdir -p /tmp/bios-sshd-p4 && cd /tmp/bios-sshd-p4
printf 'FROM alpine:3.20\nRUN apk add --no-cache openssh docker-cli\nRUN echo "root:P4ssw0rd-smoke" | chpasswd\nRUN ssh-keygen -A\nRUN sed -i -e "s/^#*PasswordAuthentication.*/PasswordAuthentication yes/" -e "s/^#*PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config\nEXPOSE 2222\nCMD ["/usr/sbin/sshd","-D","-p","2222","-e"]\n' > Dockerfile
docker build -t bios-sshd-p4 .
docker run -d --name bios-sshd-p4 -p 127.0.0.1:2203:2222 -v /var/run/docker.sock:/var/run/docker.sock bios-sshd-p4
docker exec bios-sshd-p4 docker version --format '{{.Server.Version}}'
```

Expected: версия демона (в прогоне 2026-10-10 — `28.3.2`).

- [ ] **Step 2: Панель + последовательность «aha» без ручного SSH**

```bash
cd app/backend
export DATABASE_URL="postgresql://sabir@localhost:5432/bios_test_servers?schema=public" \
  NODE_ENV=development EMAIL_VERIFY_MX=false \
  SSH_ALLOWED_PORTS=22,2203 SSH_ALLOW_LOOPBACK=true \
  THROTTLE_SSH_OPS_LIMIT=100 THROTTLE_DOCKER_READS_LIMIT=100 THROTTLE_AUTH_STRICT_LIMIT=50 \
  SERVER_CRYPTO_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
npm run build && node dist/main > /tmp/bios-panel-p4.log 2>&1 &
printf '%s' $! > /tmp/bios-panel-p4.pid
for i in $(seq 1 60); do curl -sf localhost:3000/api/v1/health >/dev/null && break; sleep 0.25; done
```

Затем: register → login → workspace → server → probe → confirm+test (из части 3) → **список контейнеров → детали упавшего → логи → stats → restart**.

Создать на хосте демона два одноразовых контейнера **из уже собранного локального образа** (брать `alpine` с Docker Hub не нужно — в прогоне 2026-10-10 локального `alpine:3.20` не было, и `docker run` ушёл бы в сеть):

```bash
docker run -d --name bios-p4-crashed bios-sshd-p4 sh -c 'echo first-line; echo boom-to-stderr >&2; exit 3'
docker run -d --name bios-p4-nop bios-sshd-p4 sleep 600
docker ps -a --format '{{.Names}} {{.Status}}' | grep bios-p4
```

Expected: `bios-p4-crashed Exited (3)`, `bios-p4-nop Up`. Перезапускаем именно `bios-p4-nop`: restart контейнера sshd (транспортного хаба) убил бы соединение посреди запроса, и это был бы тест нашей же сети, а не эндпоинта.

Команды дыма (`API=http://127.0.0.1:3000/api/v1`, куки в `/tmp/jar-p4`):

```bash
echo '--- containers ---'
curl -s -b /tmp/jar-p4 "$API/workspaces/$WS/servers/$SRV/docker/containers?all=true" -w '\nHTTP %{http_code}\n'
echo '--- crashed: state и exit code ---'
curl -s -b /tmp/jar-p4 "$API/workspaces/$WS/servers/$SRV/docker/containers/bios-p4-crashed" -w '\nHTTP %{http_code}\n'
echo '--- logs ---'
curl -s -b /tmp/jar-p4 "$API/workspaces/$WS/servers/$SRV/docker/containers/bios-p4-crashed/logs?tail=10" -w '\nHTTP %{http_code}\n'
echo '--- stats ---'
curl -s -o /dev/null -w 'stats HTTP %{http_code} за %{time_total}s\n' -b /tmp/jar-p4 "$API/workspaces/$WS/servers/$SRV/docker/containers/bios-p4-crashed/stats"
echo '--- restart на живом одноразовом контейнере ---'
curl -s -b /tmp/jar-p4 -X PATCH "$API/workspaces/$WS/servers/$SRV/docker/containers/bios-p4-nop" \
  -H 'content-type: application/json' -d '{"action":"restart"}' -w '\nHTTP %{http_code}\n'
echo '--- restart недоступен MEMBER ---'
curl -s -b /tmp/jar-member -X PATCH "$API/workspaces/$WS/servers/$SRV/docker/containers/bios-p4-nop" \
  -H 'content-type: application/json' -d '{"action":"restart"}' -w '\nHTTP %{http_code}\n'
echo '--- bad path ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b /tmp/jar-p4 "$API/workspaces/$WS/servers/$SRV/docker/containers/..%2f..%2fjson"
```

Expected — эти строки и есть доказательство, их вклеить в тело коммита:

- `containers` → `200` с массивом, где у `bios-sshd-p4` `state:"running"`, а у `bios-p4-crashed` `state:"exited"`, `exitCode:3`;
- `details` → `200` c `oomKilled:false`, `health:"NONE"`, без полей версии API демона;
- `logs` → `200`, `lines` содержит `boom-to-stderr` **и** `first-line`, ни одна строка не начинается с `\u0001` (то есть demux сработал на настоящем демоне, а не только на моке);
- `stats` на остановленном контейнере → `200` с `cpuPercent:null` (демон не даёт дельту) — это честный ответ, а не `500`;
- `restart` `bios-p4-nop` → `200 {"action":"restart","state":"running"}`, и в `docker logs bios-sshd-p4` на этот запрос ровно **одна** строка `Accepted password` (больше — значит коннектов было несколько, обещание «один коннект на запрос» нарушено);
- `restart` у MEMBER → `403`; путь `..%2f..%2f` → `400`; неподтверждённый пин → `424 HOST_KEY_NOT_TRUSTED` и в sshd — только `[preauth]` строки;
- замерить `time_total` на `stats` и `containers` — числа идут в коммит, потому что «одно соединение на запрос» — это архитектурное обещание.

- [ ] **Step 3: Убрать инфраструктуру дыма**

```bash
kill $(cat /tmp/bios-panel-p4.pid)
docker rm -f bios-p4-crashed bios-p4-nop bios-sshd-p4
rm -rf /tmp/bios-sshd-p4 /tmp/bios-dockerode-spike /tmp/jar-p4 /tmp/bios-panel-p4.log /tmp/bios-panel-p4.pid
git status --short
```

Expected: панель убита по PID (не `pkill -f`), контейнеры удалены, `/tmp/bios-dockerode-spike` (наш спайк) убран, `git status` — только чужие правки `auth/**`/`users/**`.

- [ ] **Step 4: DoD-сверка и коммит**

| Требование | Где доказано |
|---|---|
| `GET .../docker/containers` | Task 2 + e2e + живой smoke |
| `GET .../containers/:id` | Task 2 + e2e + живой smoke |
| `GET .../logs` | Task 3 (demux на моке) + живой smoke на реальном демоне |
| `GET .../stats` | Task 3 (дельта-формула) + живой smoke (время ответа) |
| `PATCH .../containers/:id` restart | Task 4 + e2e (403/400) + живой smoke |
| stub `return []` удалён | Task 2 Step 3 (grep `return [];` в `docker/` даёт 0 совпадений) |
| guard + workspace-scoping | `loadForSsh` + Task 2 (`404` неотличим, MEMBER vs OWNER) + e2e |
| e2e через куку `access_token` | Task 5 Step 2 |
| без новых зависимостей кроме dockerode | Task 0 (один коммит deps) |
| политика адресов и пин до аутентификации | Task 1 (`node-ssh.docker-transport.spec.ts`) + Task 6 (`[preauth]`) |
| ошибки Docker ≠ 5xx | Task 2 (`DOCKER_MISSING` → 424) + Task 3 (пустой stats → null) |
| логи не съедать память | Task 3 (`truncated`, `limitBytes`, тест на обрезку) |

Коммит с доказательством дыма:

```bash
git add app/backend/test/docker-operate.e2e-spec.ts
git commit -m "test(backend): docker operate e2e and live smoke over ssh transport"
```

Что smoke **не** доказывает — зафиксировать в теле коммита: `recreate` (вне P0), стриминг логов по-настоящему (`follow: true` → SSE — P1, измерено: при abort поток даёт `close`, не `end`), мульти-хостовый список одним соединением (пула нет), и любой не-Linux-хост.

---

## Self-Review

1. **Spec coverage.** Пять эндпоинтов `docs/mvp-scope.md` §4: list (Task 2), details (Task 2), logs (Task 3), stats (Task 3), restart (Task 4); роуты и shape — Task 5; DoD и живой smoke — Task 5/6. Из `API.md:43-62` сознательно не реализовано и не заглушено: `DELETE container`, `env`, `history`, `resources`, `exec`, `events`, `volumes`, `networks`, `images` — контроллер содержит ровно пять методов, стабов нет.
2. **Step scan.** Нет «TBD/позже/аналогично Task N»: тесты и реализации даны кодом, правила — числами (`262144`, `15000`, `≤ 10000` строк, `t:1`, `60/мин`, `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`). Все внешние предположения либо промаркированы измеренными фактами спайка, либо закрываются шагом проверки (`grep` строк `modem.js`, `docker images`).
3. **Type consistency.** `DockerTransport {agent, close()}` объявлен в Task 1 и используется в Task 2–4; `list/details/logs/stats/act` — имена Task 2/3/4 совпадают с вызовами контроллера в Task 5; `dockerRoutes`/`dockerRequests`/`dockerRawBodies`/`dockerLastQuery`/`transportTimeouts`/`dockerHangPrefix` добавляются в `FakeSshRunner` ровно в тех задачах, где впервые читаются; `cfg.docker.logsMaxBytes`/`statsTimeoutMs` из Task 3 читаются в Task 3 и Task 4.
4. **Proportion.** Один SSH-коннект на HTTP-запрос — не пул и не кэш; snapshot-логи — не стриминг; restart — не recreate. Каждое «не» названо в Known gaps, а не сделано наполовину.

## Known gaps (осознанные: принять или взять в P1)

- **Нет пула SSH-соединений:** каждый HTTP-запрос панели = новый KEX (~50 мс, измерено). Для экранного UI (часть 4 фронтенд) это первый кандидат на оптимизацию.
- **Логи — snapshot, не `follow`:** стриминг требует SSE/WebSocket и несовместим с профилем `sshOps`/`commandTimeoutMs`; при abort docker-стрим даёт `close`, а не `end` (измерено).
- **`stats` дорог по построению демона** (одна точка = две выборки, 1064 мс в прогоне) — отдельный таймаут и отдельный профиль троттлинга это учитывают, но батча по контейнерам нет.
- **`recreate` отсутствует:** enum `action` знает только `restart`; расширение — сознательная дыра, а не заглушка.
- **`docker system dial-stdio` требует `docker` CLI на хосте** ≥ версии, где подкоманда есть: при отсутствии получаем `424 DOCKER_MISSING`, а не «контейнеров нет» — но проверку на `docker version` (часть 3) мы не дублируем.
- **Ответы мапим руками:** новые поля Docker API в ответ не попадают (это плюс для контракта и минус для полноты: например, `health` есть только в деталях).
- **`..%2f`-защита на regex id:** имя контейнера с нестандартными символами (например, с пробелом) в Docker возможно, но нашим DTO отклоняется; на практике имена `docker run --name` так не называют.
