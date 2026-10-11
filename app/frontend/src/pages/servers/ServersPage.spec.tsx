import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { serversApi } from '../../api/servers';
import { workspacesApi } from '../../api/workspaces';
import type { Server } from '../../api/types';
import { ServersPage } from './ServersPage';

vi.mock('../../api/servers', () => ({
  serversApi: {
    list: vi.fn(),
    create: vi.fn(),
    test: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock('../../api/workspaces', () => ({
  workspacesApi: { get: vi.fn() },
}));

const api = vi.mocked(serversApi);
const workspaces = vi.mocked(workspacesApi);

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: 'srv-1',
    workspaceId: 'ws-1',
    name: 'prod-test-1',
    host: '127.0.0.1',
    port: 22,
    sshUsername: 'deploy',
    authType: 'PASSWORD',
    status: 'ONLINE',
    hostKeyFingerprint: null,
    dockerVersion: null,
    osName: null,
    agentVersion: null,
    agentInstalledAt: null,
    lastAgentStatus: null,
    lastAgentErrorCode: null,
    lastCheckedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const listServer = makeServer();
const searchAlpha = makeServer({
  id: 'srv-alpha',
  name: 'alpha-gateway',
  host: 'alpha.example.com',
});
const searchBeta = makeServer({
  id: 'srv-beta',
  name: 'beta-gateway',
  host: 'beta.example.com',
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/w/ws-1/servers']}>
        <Routes>
          <Route path="/w/:workspaceId/servers" element={<ServersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaces.get.mockResolvedValue({
    id: 'ws-1',
    name: 'ICC Проверка',
    role: 'OWNER',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
  api.list.mockResolvedValue({ items: [listServer], nextCursor: null });
  api.search.mockResolvedValue({ items: [], total: 0 });
});

test('поле поиска стоит ниже строки «Серверы», иконка — у левого края поля', async () => {
  const { container } = renderPage();

  const input = await screen.findByLabelText('Поиск серверов');
  const heading = screen.getByRole('heading', {
    level: 1,
    name: 'Серверы',
  });
  expect(
    heading.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Добавить сервер' }),
  ).toBeInTheDocument();

  const control = container.querySelector('.field-control');
  expect(control).toHaveClass('has-leading');
  const leading = control?.querySelector('svg.field-leading');
  expect(leading).not.toBeNull();
  expect(
    leading!.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test('карточка: слева иконка ОС, под именем — SSH-пользователь', async () => {
  api.list.mockResolvedValue({
    items: [makeServer({ osName: 'Ubuntu 22.04.3 LTS' })],
    nextCursor: null,
  });
  const { container } = renderPage();

  expect(await screen.findByText('prod-test-1')).toBeInTheDocument();
  const card = container.querySelector('ul.sv-grid > li.sv-card');
  expect(card).not.toBeNull();

  const icon = screen.getByRole('img', { name: 'Ubuntu 22.04.3 LTS' });
  expect(card!.contains(icon)).toBe(true);
  const name = screen.getByText('prod-test-1');
  const user = screen.getByText('deploy');
  // Шапка слева направо: иконка → имя → пользователь; обе строки — в одной колонке.
  expect(
    icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    name.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(user.closest('.sv-card-id')?.contains(name)).toBe(true);

  // Статусов в карточке нет (решение владельца 2026-10-11): они только в шторке.
  expect(card!.querySelector('.sv-card-meta')).toBeNull();
  expect(screen.queryByRole('img', { name: 'онлайн' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('img', { name: 'не установлен' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('онлайн')).not.toBeInTheDocument();

  // Хост, Docker и время проверки в карточке не показываются (решение владельца).
  expect(screen.queryByText('127.0.0.1:22')).not.toBeInTheDocument();
  expect(screen.queryByText(/Docker/)).not.toBeInTheDocument();
  expect(screen.queryByText(/проверка/)).not.toBeInTheDocument();
});

test('клик по карточке открывает шторку с деталями; «Закрыть» убирает её', async () => {
  api.list.mockResolvedValue({
    items: [
      makeServer({
        osName: 'Ubuntu 22.04.3 LTS',
        dockerVersion: '27.3.1',
        hostKeyFingerprint: 'SHA256:abc',
      }),
    ],
    nextCursor: null,
  });
  renderPage();
  await screen.findByText('prod-test-1');

  await userEvent.click(
    screen.getByRole('button', { name: 'Открыть детали: prod-test-1' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Детали сервера prod-test-1',
  });
  expect(dialog).toHaveAttribute('open');
  // Пуш-режим: оболочка отдаёт ширину шторки (Shell.css по data-drawer).
  expect(document.documentElement.dataset.drawer).toBe('open');
  expect(screen.getByText('127.0.0.1:22')).toBeInTheDocument();
  expect(screen.getByText('27.3.1')).toBeInTheDocument();
  expect(screen.getByText('Ubuntu 22.04.3 LTS')).toBeInTheDocument();
  expect(screen.getByText('пароль')).toBeInTheDocument();
  expect(screen.getByText('SHA256:abc')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(document.documentElement.dataset.drawer).toBeUndefined();
});

test('шторка: «Подключиться» запускает проверку, результат — в шторке', async () => {
  api.list.mockResolvedValue({ items: [listServer], nextCursor: null });
  api.test.mockResolvedValue({
    serverId: 'srv-1',
    reachable: true,
    trustRequired: false,
    status: 'ONLINE',
    latencyMs: 42,
    dockerVersion: '27.3.1',
    osName: null,
    dockerErrorCode: null,
    errorCode: null,
    hostKeyFingerprint: null,
    checkedAt: '2026-10-11T00:00:00.000Z',
  });
  const { container } = renderPage();
  await screen.findByText('prod-test-1');

  await userEvent.click(
    screen.getByRole('button', { name: 'Открыть детали: prod-test-1' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Детали сервера prod-test-1',
  });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Подключиться' }),
  );

  expect(api.test).toHaveBeenCalledWith('ws-1', 'srv-1', undefined);
  expect(
    await within(dialog).findByText(/соединение установлено/),
  ).toBeInTheDocument();
  // Результат «своего» сервера не дублируется над сеткой.
  expect(container.querySelector('.sv-feedback .callout')).toBeNull();
});

test('запрос уходит на сервер только после паузы; выдача — из движка', async () => {
  renderPage();
  await screen.findByText('prod-test-1');

  api.search.mockResolvedValue({ items: [searchAlpha, searchBeta], total: 2 });
  fireEvent.change(screen.getByLabelText('Поиск серверов'), {
    target: { value: 'gate' },
  });
  expect(api.search).not.toHaveBeenCalled();

  await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1), {
    timeout: 1500,
  });
  expect(api.search).toHaveBeenCalledWith(
    'ws-1',
    'gate',
    expect.objectContaining({ signal: expect.anything() }),
  );

  expect(await screen.findByText('alpha-gateway')).toBeInTheDocument();
  expect(screen.getByText('beta-gateway')).toBeInTheDocument();
  expect(screen.queryByText('prod-test-1')).not.toBeInTheDocument();
  // Счётчик из движка; листание в режиме поиска скрыто.
  expect(screen.getByText('2 сервера')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Показать ещё' }),
  ).not.toBeInTheDocument();
});

test('пустая выдача: «Ничего не найдено» с текстом запроса', async () => {
  renderPage();
  await screen.findByText('prod-test-1');

  api.search.mockResolvedValue({ items: [], total: 0 });
  fireEvent.change(screen.getByLabelText('Поиск серверов'), {
    target: { value: 'zzz' },
  });

  expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();
  expect(screen.getByText(/По запросу «zzz»/)).toBeInTheDocument();
  expect(screen.queryByText('prod-test-1')).not.toBeInTheDocument();
});

test('движок недоступен (424): ошибка с ретраем заменяет выдачу', async () => {
  renderPage();
  await screen.findByText('prod-test-1');

  api.search.mockRejectedValue(
    new ApiError(424, 'search engine is unavailable', {
      statusCode: 424,
      errorCode: 'SEARCH_UNAVAILABLE',
    }),
  );
  fireEvent.change(screen.getByLabelText('Поиск серверов'), {
    target: { value: 'prod' },
  });

  expect(
    await screen.findByText(
      'Поиск временно недоступен — служба поиска не отвечает.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Поиск недоступен')).toBeInTheDocument();
  expect(screen.queryByText('prod-test-1')).not.toBeInTheDocument();

  api.search.mockResolvedValue({ items: [searchAlpha], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('alpha-gateway')).toBeInTheDocument();
});

test('очистка запроса возвращает список и его счётчик', async () => {
  renderPage();
  await screen.findByText('prod-test-1');

  api.search.mockResolvedValue({ items: [searchAlpha], total: 1 });
  const input = screen.getByLabelText('Поиск серверов');
  fireEvent.change(input, { target: { value: 'alpha' } });
  expect(await screen.findByText('alpha-gateway')).toBeInTheDocument();

  fireEvent.change(input, { target: { value: '' } });
  expect(await screen.findByText('prod-test-1')).toBeInTheDocument();
  expect(screen.queryByText('alpha-gateway')).not.toBeInTheDocument();
  expect(screen.getByText('1 сервер')).toBeInTheDocument();
  expect(api.search).toHaveBeenCalledTimes(1);
});
