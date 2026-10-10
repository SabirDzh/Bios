# ICC Frontend — срез 1: каркас + аутентификация + пространства. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работающее десктоп-приложение: вход/регистрация → каркас с боковой навигацией → список/создание пространств → выдача и приём приглашения → аккаунт. Один сквозной поток против живого API, без моков.

**Architecture:** React 19 + Vite + TypeScript (существующий стек). Слой данных — существующий типизированный api-клиент (куки, single-flight refresh) + TanStack Query. Маршрутизация — react-router (HashRouter: переживает файловый протокол Tauri). UI — собственные примитивы на CSS custom properties (без UI-библиотек и CSS-фреймворков: стек их не содержит, а тон «точного инструмента» требует своей типографики и плотности).

**Tech Stack:** Vite 8, React 19, TS 6 (`verbatimModuleSyntax`, `erasableSyntaxOnly`), oxlint, react-router 7, @tanstack/react-query 5, lucide-react, vitest + testing-library (появляются в T1), Tauri 2.11.

**Spec / источники:**
- Бриф владельца (ICC Product Brief — разделы «Product quality», «Interaction and safety», «Architectural boundaries»).
- `docs/icc-api-matrix.md` — матрица «фича → API» и гэпы (источник истины о контрактах).
- Существующий код: `app/frontend/src/api/*` (клиент), контроллеры/сервисы `app/backend/src/modules/*`.

## Global Constraints

- **Только фронтенд.** Ничего в `app/backend` не менять (там незакоммиченный срез deploy от прошлой сессии — не трогать и не коммитить). Работаем в `app/frontend` + `docs/`.
- **Коммиты не делать** без отдельной команды владельца (`git commit` не выполняется ни в одном шаге).
- **Язык интерфейса — русский.** Глоссарий: workspace → «пространство», server → «сервер», container → «контейнер», deployment → «деплой», deploy config → «конфигурация деплоя», invitation → «приглашение», agent → «агент», fingerprint → «отпечаток», logs → «логи», stats → «нагрузка», restart → «перезапустить», reveal → «показать», stale → «устарело».
- **Моков в UI нет.** Данные — только из API. Фикстуры допустимы в тестах и на dev-витрине `/kit` (явно помечена как витрина примитивов).
- **Стиль:** сдержанная консоль. Запрещено: градиенты, «стекло», гигантские заголовки, декоративные анимации, избыточные карточки. База 13px, технические значения (id, отпечатки, образы, порты, логи) — моноширинно. Обе темы: dark по умолчанию (system), light — переключателем.
- **Обязательные состояния на каждой поверхности:** загрузка (скелет), пусто, ошибка (+повтор), нет доступа, нет соединения, успех. Деструктивных операций в этом срезе нет — но диалог подтверждения появится в срезе контейнеров.
- **TS-правила стека:** без `enum` (`erasableSyntaxOnly`), `import type` для типов, без неиспользуемых имён (`noUnusedLocals`), strict.
- **a11y:** focus-visible-кольцо на всех интерактивах, `<label>` у полей, `role="alert"` у ошибок форм, нативный `<dialog>` для модалок.
- **Время/числа:** `Intl.DateTimeFormat('ru-RU')`, числа с моно-разрядностью там, где это метрики. Относительное время — свой хелпер `formatRelative` («только что», «5 мин назад»).
- **Новые зависимости (и только эти):** `@tanstack/react-query`, `react-router`, `lucide-react`; dev: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
- Существующий `src/api/client.ts` **не переписывать** — только расширять (он уже реализует single-flight refresh, критичный при ротации с отзывом семейства).

---

## Файловая карта среза 1

```
app/frontend/
  package.json                 — +скрипты test/test:watch, +зависимости (T1)
  vite.config.ts               — не трогать; тестовый конфиг отдельно
  vitest.config.ts             — создать (T1)
  src/test/setup.ts            — jest-dom, полифиллы (T1)
  src/styles/tokens.css        — токены: обе темы (T1)
  src/styles/base.css          — reset, типографика, скроллбары (T1)
  src/theme/theme.ts           — режим темы (system|dark|light), apply (T1)
  src/main.tsx                 — bootstrap: тема + провайдеры (T1, T4)
  src/ui/…                     — примитивы + /kit-витрина (T2)
  src/api/health.ts            — GET /health (T3)
  src/errors/errorText.ts      — маппинг ошибок → русский текст (T3)
  src/api/client.spec.ts       — single-flight refresh, envelope (T3)
  src/auth/SessionProvider.tsx — сессия (me/вход/выход) (T4)
  src/app/App.tsx              — таблица маршрутов (T4)
  src/app/Shell.tsx + .css     — каркас: Sidebar, Topbar, баннер (T4)
  src/app/nav.ts               — конфиг навигации (T4; пополняется срезами)
  src/pages/auth/{Login,Register}Page.tsx + auth.css (T4)
  src/pages/workspaces/WorkspacesPage.tsx     — список + онбординг (T5)
  src/pages/workspaces/WorkspaceHomePage.tsx  — приглашения (T6)
  src/pages/join/JoinPage.tsx                 — приём приглашения (T6)
  src/pages/account/AccountPage.tsx           — профиль/пароль/выход (T7)
  src/api/lastWorkspace.ts     — localStorage последнего пространства (T5)
  src-tauri/tauri.conf.json    — окно, CSP (T8)
```

Дальние срезы (пишутся отдельными планами по мере готовности): серверы (TOFU,
агент), контейнеры (список/детали/логи/статы/рестарт), деплой
(проекты/конфиги/запуск/логи), обзорная страница.

---

### Task 1: Зависимости, vitest, токены, тема

**Files:**
- Modify: `app/frontend/package.json` (deps + scripts)
- Create: `app/frontend/vitest.config.ts`, `app/frontend/src/test/setup.ts`
- Create: `app/frontend/src/styles/tokens.css`, `app/frontend/src/styles/base.css`
- Create: `app/frontend/src/theme/theme.ts`, `app/frontend/src/theme/theme.spec.ts`
- Modify: `app/frontend/src/main.tsx`, `app/frontend/index.html` (title «Bios», lang «ru»)
- Delete: `src/App.css`, `src/App.tsx` (стартерный демо-экран), `src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`

**Interfaces:**
- Produces: `initTheme(): ThemeMode`, `setThemeMode(m: ThemeMode)`, `getThemeMode(): ThemeMode`, `type ThemeMode = 'system' | 'dark' | 'light'` (из `src/theme/theme.ts`); CSS-классы примитивов используют токены ниже.

- [ ] **Step 1: Установить зависимости**

```bash
cd app/frontend
npm i @tanstack/react-query react-router lucide-react
npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Записать фактические версии из `package.json` в отчёт.

- [ ] **Step 2: Скрипты и vitest-конфиг**

`package.json` scripts += `"test": "vitest run"`, `"test:watch": "vitest"`.

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
```

`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Токены (обе темы) — `src/styles/tokens.css`**

```css
:root {
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --radius-sm: 6px; --radius-md: 8px;
  --font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 15px; --text-lg: 20px;
  --leading: 1.45; --row-h: 34px; --sidebar-w: 232px; --topbar-h: 48px;
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #101214; --bg-raised: #17191c; --bg-inset: #0b0d0f; --bg-hover: #1d2024; --bg-active: #23262b;
  --border: #24282d; --border-strong: #343a41;
  --text: #c9d1d8; --text-strong: #eef1f4; --text-muted: #7e8790;
  --accent: #4c9aff; --accent-hover: #66a9ff; --accent-muted: rgba(76,154,255,.14); --on-accent: #0b1220;
  --ok: #3fb950; --warn: #d29922; --danger: #f85149; --info: #58a6ff; --neutral: #8b949e;
  --ok-muted: rgba(63,185,80,.14); --warn-muted: rgba(210,153,34,.15);
  --danger-muted: rgba(248,81,73,.14); --neutral-muted: rgba(139,148,158,.14); --info-muted: rgba(88,166,255,.14);
  --focus: 0 0 0 2px rgba(76,154,255,.55);
  --shadow-pop: 0 8px 28px rgba(0,0,0,.45);
}
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f6f7f8; --bg-raised: #ffffff; --bg-inset: #f0f1f3; --bg-hover: #eceef1; --bg-active: #e4e7ea;
  --border: #d8dce0; --border-strong: #b9bfc6;
  --text: #2f353b; --text-strong: #14181c; --text-muted: #636c75;
  --accent: #0b62d0; --accent-hover: #0a55b4; --accent-muted: rgba(11,98,208,.10); --on-accent: #ffffff;
  --ok: #1a7f37; --warn: #9a6700; --danger: #cf222e; --info: #0969da; --neutral: #6b7278;
  --ok-muted: rgba(26,127,55,.10); --warn-muted: rgba(154,103,0,.12);
  --danger-muted: rgba(207,34,46,.10); --neutral-muted: rgba(107,114,120,.12); --info-muted: rgba(9,105,218,.10);
  --focus: 0 0 0 2px rgba(11,98,208,.45);
  --shadow-pop: 0 8px 28px rgba(20,24,28,.16);
}
```

- [ ] **Step 4: База — `src/styles/base.css`**

Reset (`box-sizing: border-box`, обнуление margin), `body { background: var(--bg); color: var(--text); font: var(--text-base)/var(--leading) var(--font-ui); }`, заголовки `color: var(--text-strong)`, скроллбары thin, `::selection`, `:focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--radius-sm); }`, `.mono { font-family: var(--font-mono); }`, `.visually-hidden`, класс `.page` (контентная обёртка с паддингами `--space-5`, max-width 1200px).

- [ ] **Step 5: Тема — тест, затем реализация**

`src/theme/theme.spec.ts` (пишем первым, запускаем — падает):
```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyTheme, clampMode, resolveTheme } from './theme';

const matchMedia = (dark: boolean) =>
  ({ matches: dark } as MediaQueryList);

beforeEach(() => localStorage.clear());

describe('resolveTheme', () => {
  test('system + тёмная ОС → dark', () => {
    expect(resolveTheme('system', matchMedia(true))).toBe('dark');
  });
  test('system + светлая ОС → light', () => {
    expect(resolveTheme('system', matchMedia(false))).toBe('light');
  });
  test('явный режим сильнее системы', () => {
    expect(resolveTheme('light', matchMedia(true))).toBe('light');
  });
});

describe('clampMode', () => {
  test('неизвестное хранимое значение → system', () => {
    expect(clampMode('neon')).toBe('system');
    expect(clampMode(null)).toBe('system');
  });
});

describe('applyTheme', () => {
  test('проставляет data-theme на html', () => {
    vi.stubGlobal('matchMedia', () => matchMedia(true));
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.unstubAllGlobals();
  });
});
```

`src/theme/theme.ts` (минимальная реализация под тест + подписка на смену системы):
```ts
export type ThemeMode = 'system' | 'dark' | 'light';
export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'bios.theme-mode';

export function clampMode(value: unknown): ThemeMode {
  return value === 'dark' || value === 'light' ? value : 'system';
}
export function getThemeMode(): ThemeMode {
  return clampMode(localStorage.getItem(STORAGE_KEY));
}
export function resolveTheme(mode: ThemeMode, mql: MediaQueryList): Theme {
  if (mode !== 'system') return mode;
  return mql.matches ? 'dark' : 'light';
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(resolveTheme(mode, window.matchMedia('(prefers-color-scheme: dark)')));
}
export function initTheme(): ThemeMode {
  const mode = getThemeMode();
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(resolveTheme(mode, mql));
  mql.addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme(resolveTheme('system', mql));
  });
  return mode;
}
```

- [ ] **Step 6: main.tsx + index.html**

`main.tsx`: `initTheme();` + импорты `./styles/tokens.css`, `./styles/base.css`; временно рендерить `<div className="page">Каркас в работе</div>` (заменяется в T4). Удалить стартерные файлы и ассеты (см. Files). `index.html`: `<html lang="ru">`, `<title>Bios</title>`.

- [ ] **Step 7: Проверка**

Run: `npm run test` → theme.spec зелёный. Run: `npm run build` → успешно. Run: `npm run dev` → страница тёмная, текст в токенах; в DevTools сменить системную тему — перекрашивается.

---

### Task 2: UI-примитивы + витрина `/kit`

**Files:**
- Create: `src/ui/{Button,TextField,Chip,Spinner,Skeleton,EmptyState,ErrorState,Table,Modal,CopyButton}.tsx` (+ co-located `.css`)
- Create: `src/ui/CopyButton.spec.tsx`, `src/ui/KitPage.tsx`
- Modify: `src/styles/base.css` (общие классы таблицы/форм, если не в компонентах)

**Interfaces:**
- Produces (все — из `src/ui/…`):
  - `Button({ variant?: 'primary'|'default'|'ghost'|'danger', size?: 'md'|'sm', loading?: boolean, icon?: ReactNode, children, …buttonProps })`
  - `TextField({ label, value, onChange, type?, placeholder?, error?, hint?, autoComplete?, autoFocus?, disabled?, required? })` — рендерит `<label>` + `<input>` + hint/error (`role="alert"` у error)
  - `Chip({ tone: 'ok'|'warn'|'danger'|'info'|'neutral'|'accent', children, title? })` — точка + текст, не только цветом (a11y)
  - `Spinner({ size?: number })`, `Skeleton({ w?, h?, lines? })`
  - `EmptyState({ icon?, title, description?, action? })`, `ErrorState({ title, description?, onRetry?, retryLabel? })`
  - `Table` — стилевая обёртка: `<Table>{<thead>…}</Table>` (классы `.table`; строки 34px, числа/технические значения — `.mono`)
  - `Modal({ open, onClose, title, children, footer? })` — нативный `<dialog>`, Escape и клик по фону закрывают, фокус на первый интерактив
  - `CopyButton({ value, label? })` — копирует и на 2 c меняет подпись на «Скопировано»; fallback через `document.execCommand` при отсутствии `navigator.clipboard`

- [ ] **Step 1: Тест CopyButton (сначала падающий)**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CopyButton } from './CopyButton';

test('копирует значение и подтверждает', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(<CopyButton value="token-123" />);
  await userEvent.click(screen.getByRole('button'));
  expect(writeText).toHaveBeenCalledWith('token-123');
  expect(await screen.findByText('Скопировано')).toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run → падает** (`npm run test -- CopyButton`), затем реализовать примитивы (Step 1 интерфейсов) и прогнать снова → зелёный.

- [ ] **Step 3: Витрина** — `src/ui/KitPage.tsx`: страница «Витрина примитивов (dev)»: все Button-варианты и размеры, поля (обычное/ошибка/hint/disabled), Chip-тоны, Spinner/Skeleton, EmptyState/ErrorState, пример таблицы, Modal по кнопке, CopyButton. Маршрут подключается в T4 как `/kit` **только при `import.meta.env.DEV`**.

- [ ] **Step 4: Проверка** — `npm run test`, `npm run lint`, `npm run build`; визуальная проверка обеих тем (ручная, отметить в отчёте).

---

### Task 3: API-слой — health, errorText, тесты клиента

**Files:**
- Create: `src/api/health.ts`, `src/errors/errorText.ts`, `src/errors/errorText.spec.ts`, `src/api/client.spec.ts`
- Modify: `src/api/index.ts` (реэкспорты)

**Interfaces:**
- Produces:
  - `fetchHealth(): Promise<{status: string; timestamp: string}>` (`apiGet('/health', { retryOnAuth: false })`)
  - `errorText(err: unknown, context?: 'login'|'session'|'invite'|'accept'|'generic'): string`
  - `codeText(code: string | null | undefined): string | null` — словарь кодов (ниже)

- [ ] **Step 1: Тест клиента — single-flight refresh (сначала падающий)**

`src/api/client.spec.ts`:
```ts
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, apiGet } from './client';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('401 → один refresh → повтор запроса', async () => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/refresh')) return jsonResponse(200, {});
    if (calls.filter((c) => c.includes('/workers')).length === 1)
      return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
    return jsonResponse(200, { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(apiGet('/workers')).resolves.toEqual({ ok: true });
  expect(calls.filter((c) => c.endsWith('/auth/refresh'))).toHaveLength(1);
});

test('параллельные 401 используют один refresh', async () => {
  let refreshCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, {});
    }
    if (refreshCalls === 0)
      return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
    return jsonResponse(200, { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  await Promise.all([apiGet('/a'), apiGet('/b')]);
  expect(refreshCalls).toBe(1);
});

test('ошибка → ApiError с русским fallback из envelope', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    jsonResponse(404, { statusCode: 404, message: 'workspace not found' })));
  await expect(apiGet('/x')).rejects.toBeInstanceOf(ApiError);
});
```

Run: `npm run test -- client` → падает на первом (клиент существует, но тесты новые — прогнать и убедиться, что падают по причине отсутствия тестового файла/окружения, не по логике; после создания — зелёные). Если тест выявил баг клиента — починить по минимуму, не переписывать.

- [ ] **Step 2: errorText**

Правила: `ApiError.status` и `errorCode` из payload (`payload.errorCode`). Контексты:
- `login`: 401 → «Неверный email или пароль.»; 429 → «Слишком много попыток входа. Подождите минуту.»
- `session`: 401 → «Сессия истекла — войдите снова.»
- `accept`: 403 → «Приглашение выдано на другой адрес.»; 404 → «Приглашение не найдено, истекло или отозвано.»; 409 → «Вы уже участник этого пространства.»
- `invite`: 409 → «Этот адрес уже участвует в пространстве.»
- `generic`: 400 с массивом `message` → склеенные строки как есть (серверный текст); 5xx → «Ошибка панели. Попробуйте ещё раз.»
- Сетевая ошибка (`TypeError` из fetch) → «Нет соединения с сервером панели.»
- `codeText` — словарь всех кодов (SshErrorCode + DeployErrorCode), например:
  AUTH_FAILED «Сервер отклонил аутентификацию: проверьте имя пользователя и ключ/пароль.»; TIMEOUT «Превышено время ожидания ответа от сервера.»; REFUSED «Соединение отклонено: порт SSH закрыт или сервис не слушает.»; DNS «Не удалось разрешить имя хоста.»; HOST_KEY «Ошибка проверки ключа хоста.»; NETWORK «Сеть недоступна: хост не отвечает.»; HOST_UNREACHABLE «Хост недоступен.»; HOST_KEY_NOT_TRUSTED «Отпечаток ключа хоста не подтверждён.»; HOST_KEY_MISMATCH «Отпечаток ключа хоста изменился — соединение прервано.»; TARGET_BLOCKED «Адрес хоста запрещён политикой панели.»; PORT_NOT_ALLOWED «Порт вне разрешённого списка панели.»; RESOLUTION_FAILED «Не удалось определить адрес хоста.»; DOCKER_MISSING «Docker не установлен на сервере.»; DOCKER_PERMISSION_DENIED «Нет прав на сокет Docker: пользователя нужно добавить в группу docker.»; DOCKER_SOCKET_UNREACHABLE «Docker-демон не отвечает через сокет.»; DOCKER_UNREACHABLE «Docker API недоступен на сервере.»; SYSTEMD_MISSING «На сервере нет systemd — установка агента невозможна.»; SUDO_REQUIRED «Для установки нужен sudo без пароля (NOPASSWD).»; MANIFEST_INVALID «Манифест агента повреждён.»; IDENTITY_MISMATCH «На сервере агент другого пространства или сервера.»; AGENT_NOT_RUNNING «Агент не запущен.»; AGENT_HEARTBEAT_STALE «Агент давно не выходил на связь.»; AGENT_VERSION_MISMATCH «Версия агента не совпадает с версией панели.»; AGENT_MANIFEST_MISSING «Файл манифеста агента отсутствует.»; COMMAND_FAILED «Команда на сервере завершилась с ошибкой.»; READ_FAILED «Не удалось прочитать состояние агента.»; GIT_MISSING «git не установлен на сервере.»; REF_NOT_FOUND «Ветка или тег не найдены в репозитории.»; DOCKERFILE_MISSING «Dockerfile не найден по указанному пути.»; SOURCE_FAILED «Не удалось получить исходники (git clone).»; BUILD_FAILED «Сборка образа завершилась с ошибкой.»; RUN_FAILED «Не удалось запустить контейнер.»; SNAPSHOT_INVALID «Снимок конфигурации деплоя повреждён.»; PANEL_RESTARTED «Деплой прерван перезапуском панели.»; ACCESS_LOST «У инициатора пропал доступ к пространству.»

Тесты `errorText.spec.ts`: 401 login, 404 accept, 409 invite, 424 с errorCode (HOST_KEY_NOT_TRUSTED), 429 login, сетевой TypeError, 400 с массивом message.

- [ ] **Step 3: Проверка** — `npm run test` (все спеки), `npm run lint`, `npm run build`.

---

### Task 4: Сессия + маршрутизация + каркас + вход/регистрация

**Files:**
- Create: `src/auth/SessionProvider.tsx`, `src/app/App.tsx`, `src/app/Shell.tsx` + `Shell.css`, `src/app/nav.ts`, `src/app/ConnectionBanner.tsx`
- Create: `src/pages/auth/{LoginPage,RegisterPage,AuthLayout}.tsx` + `auth.css`
- Modify: `src/main.tsx` (QueryClientProvider + HashRouter + SessionProvider)

**Interfaces:**
- Consumes: `authApi` (существует), `errorText` (T3), примитивы (T2), `authKeys` (существует).
- Produces: `useSession(): { status: 'checking'|'anonymous'|'authenticated'; user: SessionUser|null; login(i: LoginInput): Promise<void>; logout(): Promise<void>; reload(): void }`; `RequireSession` (компонент-обёртка); `NavItem` конфиг в `nav.ts`.

Маршруты (HashRouter):
```
/login, /register            — анонимные (аутентифицированного редиректят на /workspaces)
/join/:workspaceId/:token    — только с сессией
/workspaces                  — с сессией: список/создание
/w/:workspaceId              — с сессией + проверка членства (GET workspace): index → WorkspaceHomePage (T6)
/account                     — с сессией
/kit                         — только import.meta.env.DEV
```
`/` → redirect на последнее пространство (`lastWorkspace.ts`, T5) или `/workspaces`.

- [ ] **Step 1: SessionProvider** — `useQuery({ queryKey: authKeys.session(), queryFn: authApi.me, retry: false })`. Маппинг: успех → authenticated; `ApiError 401` → anonymous; любая другая ошибка (сеть/5xx) → status `checking` + флаг `sessionError` (рендерим ErrorState «Панель недоступна», не разлогиниваем). `login` → `authApi.login` → `queryClient.fetchQuery(me)`; `logout` → `authApi.logout` → `setQueryData(authKeys.session(), null)` → navigate `/login`.
- [ ] **Step 2: RequireSession** — checking → центрированный Spinner (минимальная страница); sessionError → ErrorState с «Повторить» (`reload`); anonymous → `<Navigate to="/login" state={{ returnTo }} replace/>`; authenticated → `<Outlet/>`.
- [ ] **Step 3: LoginPage** — поля email/пароль, кнопка с `loading`, ошибки через `errorText(err,'login')` в `role="alert"`, ссылка на `/register`. После входа — `navigate(returnTo ?? '/')`. Дисклеймер не нужен — вход не требует подтверждения почты.
- [ ] **Step 4: RegisterPage** — username/email/пароль + клиентская валидация (username: 3–64, `[a-z0-9._-]`, приводим к нижнему регистру при вводе; email: `\S+@\S+\.\S+`, 6–254; пароль: 8–128 без пробелов; подсказки — текстом под полем). Успех → сообщение «Аккаунт создан. Войдите.» → переход на `/login` с предзаполненным email. Серверные ошибки (400) показываем как есть в alert.
- [ ] **Step 5: Shell** — сетка `[sidebar | main]`, main = `[topbar | banner | content]`. Sidebar: логотип-текст «Bios» + секции из `nav.ts` (в срезе: «Пространства» `/workspaces`, «Аккаунт» `/account`; секция пространства наполняется в T5/T6 и следующих срезах). Topbar: слева — хлебная крошка/имя пространства (резерв под switcher, T5), справа — переключатель темы (иконка sun/moon, `setThemeMode`), меню пользователя (username, «Аккаунт», «Выйти»). Меню — на `<details>` или кнопка+popover на CSS; закрытие по Escape/клику вне.
- [ ] **Step 6: ConnectionBanner** — `useQuery({queryKey:['health'], queryFn:fetchHealth, refetchInterval:30_000, retry:false})`; при ошибке и статусе authenticated — полоса `warn` сверху: «Нет соединения с сервером панели — показаны последние данные.»; при восстановлении исчезает (сбросить интервал при anonymous).
- [ ] **Step 7: Проверка (живой бэкенд).** Backend: `cd app/backend && npm run start:dev` (Postgres уже слушает; если Prisma Client устарел — `npx prisma generate`). Frontend: `npm run dev`. Сценарий: без сессии `/workspaces` → редирект на `/login`; вход → каркас; перезагрузка → сессия сохраняется (me); «Выйти» → `/login` и куки очищены (проверить DevTools); остановить бэкенд → баннер «Нет соединения…»; включить → баннер исчезает. Отметить в отчёте фактические шаги.

---

### Task 5: Пространства — список, создание, онбординг, переключатель

**Files:**
- Create: `src/api/lastWorkspace.ts` (+ `lastWorkspace.spec.ts`), `src/pages/workspaces/WorkspacesPage.tsx` (+ css)
- Modify: `src/app/Shell.tsx` (switcher в topbar), `src/app/App.tsx` (`/w/:workspaceId` layout + проверка членства), `src/app/nav.ts`

**Interfaces:**
- Consumes: `workspacesApi` (существует: `list()`, `create()`, `get()`), `workspaceKeys` (существует).
- Produces: `getLastWorkspaceId(): string|null`, `setLastWorkspaceId(id: string|null)`; `WorkspaceLayout` (проверяет `GET workspace`, 404 → ErrorState «Нет доступа или пространство удалено»).

- [ ] **Step 1: lastWorkspace** — обёртка localStorage `bios.last-workspace` + spec (set/get/сброс).
- [ ] **Step 2: WorkspacesPage** — `useQuery(workspaceKeys.list(), () => workspacesApi.list())` (курсор до 20; «Показать ещё» при `nextCursor`). Пусто → EmptyState-онбординг: инпут имени (правило `[\p{L}\p{N} _#-]{1,64}`, подсказка «Только буквы, цифры, пробел и - _ #»), кнопка «Создать пространство» → мутация → инвалидация → переход в новое пространство. Для непустого списка: таблица (имя, роль — чип OWNER «владелец»/MEMBER «участник», создано) + форма создания в шапке (модалка или раскрывающаяся панель — модалка).
- [ ] **Step 3: WorkspaceLayout + switcher** — контекст текущего пространства через `useParams`; `useQuery(workspaceKeys.detail(id), () => workspacesApi.get(id))`; при 404 — ErrorState. Switcher в topbar: список пространств (тот же list-запрос), выбор → `setLastWorkspaceId` + navigate `/w/:id`; при выборе — закрыть.
- [ ] **Step 4: Проверка** — живой прогон: создать первое пространство (онбординг), второе из шапки; перезагрузка → приложение открывается на последнем; удалить последнее из localStorage руками → открывается `/workspaces`.

---

### Task 6: Приглашения — выдача токена и приём

**Files:**
- Create: `src/pages/workspaces/WorkspaceHomePage.tsx` (+ css), `src/pages/join/JoinPage.tsx`
- Modify: `src/app/App.tsx` (index-маршрут `/w/:id` → WorkspaceHomePage; `/join/...`)

**Interfaces:**
- Consumes: `workspacesApi.invite/accept` (существуют), `CopyButton` (T2), `errorText` (T3).

Реальность API (не замазывать): почта не отправляется, список участников и список приглашений недоступны; приглашение — это пара «workspaceId + token», выданная один раз.

- [ ] **Step 1: WorkspaceHomePage** — секция «Пригласить участника» (только OWNER; для MEMBER секция скрыта с пометкой «Доступно владельцу»): поле email + кнопка. Ответ → панель результата: токен (`.mono`, `CopyButton`), `expiresAt` («действует до …», `Intl.DateTimeFormat`), предупреждение «Токен показывается один раз. Передайте его приглашённому вместе с идентификатором пространства.» + `CopyButton` на строку `bios://join/<workspaceId>/<token>`. Повторный инвайт того же адреса: сервер ревокает старый — текст предупреждения на форме.
- [ ] **Step 2: JoinPage** — маршрут `/join/:workspaceId/:token` (сессия обязательна; аноним → `/login` с returnTo, после входа возврат сюда). Автозаполнение из параметров + ручная форма «Идентификатор пространства + Токен» (для передачи парой). Кнопка «Принять приглашение» → `accept` → успех: `setLastWorkspaceId` + navigate в пространство; ошибки через `errorText(err,'accept')`. Плюс постоянная ссылка в Shell? Нет — вход: пункт меню пользователя «Принять приглашение» → `/join/` (пустые поля).
- [ ] **Step 3: Проверка** — два аккаунта (две браузерные сессии или профили): A создаёт пространство и инвайт, копирует пару; B (другой email) входит, `/join/<ws>/<token>` → принято → пространство появилось у B; повторный accept → «вы уже участник»; чужой email → 403-текст; мусорный токен → 404-текст.

---

### Task 7: Аккаунт — профиль, пароль, выход, тема

**Files:**
- Create: `src/pages/account/AccountPage.tsx` (+ css)
- Modify: `src/api/auth.ts` (добавить `changePassword(old, new)`, `usersApi`-функцию в модуль auth или отдельный `src/api/users.ts`)

**Interfaces:**
- Produces: `usersApi.changePassword({ oldPassword, newPassword }): Promise<void>` → `PATCH /users/change-password` (`retryOnAuth:false`).

- [ ] **Step 1: AccountPage** — профиль (username, email, «сессия с …» — `sid` не показывать; данные из `useSession().user` — **без** запроса `/users/me`, там только payload токена; фактически `auth/me` возвращает `{userId, username, email, sid}` — показываем username/email). Смена пароля: старый/новый (+повтор нового, клиентская сверка), после успеха сервер очищает куки → показать «Пароль изменён. Войдите заново.» → `logout()`-локально и navigate `/login`. Смена темы: 3 варианта (Системная/Тёмная/Светлая) радиокнопками, `setThemeMode`.
- [ ] **Step 2: Проверка** — смена пароля при живом бэкенде: успех → редирект на логин → вход новым паролем; неверный старый → серверная ошибка в alert (401 → «Неверный пароль»); тема переключается и переживает перезагрузку.

---

### Task 8: Tauri — окно и CSP

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Конфиг окна** — `width: 1280, height: 800, minWidth: 960, minHeight: 600, title: "Bios"` (уже), `resizable: true`.
- [ ] **Step 2: CSP** — `"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://localhost:3000 https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"`, `"devCsp": null` (в dev грузится Vite-страница с HMR — CSP не мешает; прод-сборка идёт через свой протокол). Комментарий в отчёте: для прод-сборки с собственным API-домом `connect-src` сузить до `https://<api-host>` (VITE_API_URL) — сейчас допущен `https:` как запас для self-host API.
- [ ] **Step 3: Capabilities** — не расширять (`core:default`); новых плагинов нет, нативных команд из JS в срезе нет.
- [ ] **Step 4: Проверка** — `npm run tauri:dev` (Rust-тулчейн есть, target/ собран ранее): окно 1280×800, вход/выход работают в webview, HMR живой. Если macOS-окно с `tauri://localhost` не пускает куки к `http://localhost:3000` — зафиксировать как ограничение (кookie SameSite=Lax, scheme mismatch) и проверить dev-режим (devUrl http://localhost:5173 — origin НЕ tauri://, куки работают). Прод-разбор этого — отдельный пункт отчёта, не «молчаливое» решение.

---

### Task 9: Верификация среза и отчёт

- [ ] **Step 1:** `npm run test` → все спеки зелёные (зафиксировать счёт).
- [ ] **Step 2:** `npm run lint` → чисто. `npx tsc -b` → чисто.
- [ ] **Step 3:** `npm run build` → прод-сборка успешна.
- [ ] **Step 4:** Живой прогон по чек-листу состояний: загрузка (скелеты), пустой список пространств (онбординг), ошибка сервера (ErrorState + повтор), нет соединения (баннер), 401-редирект по истечении access-куки (подождать 10 мин или очистить cookie `access_token` в DevTools), 429 (несколько быстрых логинов подряд → текст троттлинга), нет доступа (чужой `/w/:id` → 404-состояние), успех (инвайт+приём).
- [ ] **Step 5:** Размеры окна: 960×600 (минимальный), 1280×800, 1920×1080 — сайдбар не ломается, контент скроллится, длинные имена пространств обрезаются с ellipsis и видимы в `title`.
- [ ] **Step 6:** Записать в конец этого файла раздел «Результаты прогона» (дата, команды, вывод, что не проверено и почему) + обновить `docs/icc-api-matrix.md`, если обнаружились расхождения.

---

## Self-review (выполнен при написании)

- Покрытие брифа: каркас и навигация (T4), состояния loading/empty/error/no-access/disconnected (T2, T4, T5), безопасность секретов — секретов в срезе нет, кроме паролей аккаунта (инпуты с type=password; значения не логируются), подтверждения деструктивных операций — деструктивных операций в срезе нет (появятся с рестартом контейнера), Tauri — минимальные права (T8), темы (T1), RU-копирайт (глоссарий), проверки (T9).
- Вне среза сознательно: серверы, контейнеры, деплой, обзорная страница, восстановление пароля (API есть, P1), список участников (API нет).
- Плейсхолдеров нет: каждый шаг содержит файл, интерфейс и команду проверки; код приведён для неочевидных мест (токены, тема, тесты клиента, CSP).
- Согласованность имён: `useSession`, `errorText`, `codeText`, `fetchHealth`, `lastWorkspace.ts`, классы `.page`, `.table`, `.mono` используются одинаково во всех задачах.

---

## Результаты прогона (2026-10-11, 00:00–00:26)

**Команды (финальный прогон после всех правок):**
- `npm run test` — 5 файлов, 25 тестов, все зелёные.
- `npx tsc -b` — чисто; `npm run lint` — 0 warnings/0 errors (49 файлов).
- `npm run build` — ок: `index-*.js` 308 KB (gzip 96 KB), CSS 16 KB.
- `npm audit` — 0 vulnerabilities (source-map-js high из транзитивных был починен `npm audit fix`).
- Backend: `npm run start:dev` против Postgres (миграции: «Database schema is up to date», 7 миграций) — стартует и отвечает `/api/v1/health`.

**Живой E2E (браузер, реальные аккаунты):**
- Регистрация `e2eone` (icc-e2e-one@yandex.ru, MX/disposable-валидация бэкенда прошла) → notice «Аккаунт создан», email предзаполнен.
- Вход → онбординг-пусто → создание пространства «E2E Стенд 1» (`01a127a5-…`) → инвайт `e2etwo` → токен показан один раз, expiry «12 окт.» (TTL 1 сутки — совпадает с `INVITATIONS_TTL_SEC`).
- Логаут → регистрация/вход `e2etwo` → last-workspace перевёл на чужое пространство → корректное «Пространство недоступно / Нет доступа…» + «Ко всем пространствам».
- Приём приглашения через форму `/join` (пара «id + токен») → роль «участник», секция инвайта заменена пометкой «только владелец».
- Повторный accept потреблённого токена → 404 «Приглашение не найдено, истёкло или отозвано» (бэкенд проверяет статус раньше членства — текст соответствует коду).
- Ошибка входа: неверный пароль → «Неверный email или пароль.»; 11-й запрос подряд → 429, UI показал «Слишком много попыток входа. Подождите минуту.».
- Backend остановлен → перезагрузка → «Панель недоступна. Не удалось связаться с сервером панели.» → backend поднят → «Повторить» → форма входа.
- Длинное имя (64 символа) — создано, навигация не ломается; замер 708×834: горизонтального overflow нет (`scrollWidth == innerWidth`), сайдбар 232 px фиксирован.
- Тема: переключение dark⇄light через topbar (dataset + localStorage + computed background `rgb(246,247,248)`), выбор в «Аккаунте» — состояние сохраняется.

**Найдено E2E-прогоном и исправлено в нём же:**
1. Логаут фонил ошибкой: `queryClient.clear()` будил защищённые запросы до смены статуса сессии. Фикс: мгновенный `setQueryData(session, null)` → гейт редиректит → затем `removeQueries` (кроме auth). Плюс 401 в контенте теперь отдан слою сессии (`isUnauthorized` → спиннер вместо «Не удалось загрузить»).
2. `refresh` под троттлингом (429) классифицировался как «панель недоступна». Фикс: 429 → вход; «мёртвая сессия» (refresh 401/403) запоминается флагом `refreshDisabled` — повторные 401 не долбят refresh (тест появился).
3. Свитчер показывал «…» на пространстве без доступа → «Нет доступа».

**Tauri:** `npm run tauri:dev` — сборка 25.6 s, `target/debug/app` запущен, WebKit-процесс держит соединение с `localhost:5173` (lsof) — окно загрузило приложение. Окно 1280×800, min 960×600, CSP прод-сборки задан, `devCsp: null`.

**Не проверено в этом прогоне (честно):**
- Скриншоты поверхностей: in-app browser без видимой поверхности (`visibilityState=hidden`), окно Tauri не снималось, чтобы не захватывать рабочий стол.
- Взаимодействие внутри Tauri-окна (вход в WKWebView) — не автоматизировано; окно оставлено открытым для ручной проверки. Cookie-jar у WKWebView отдельный; origin dev-окна — `http://localhost:5173`, CORS уже разрешён.
- Визуальная проверка на 960/1280/1920 — только структурная (708×834 без overflow + мин. размеры в конфиге); полный визуальный проход — при использовании окна.
- Восстановление пароля и список участников — сознательно вне среза (первое — P1, второе — нет API).

