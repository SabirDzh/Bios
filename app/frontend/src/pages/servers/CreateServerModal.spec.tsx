import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import { serversApi } from '../../api/servers';
import type { ServerTestResult } from '../../api/types';
import { CreateServerModal } from './CreateServerModal';

vi.mock('../../api/servers', () => ({
  serversApi: { create: vi.fn(), testConnection: vi.fn() },
}));

const api = vi.mocked(serversApi);

function result(overrides: Partial<ServerTestResult> = {}): ServerTestResult {
  return {
    serverId: null,
    reachable: true,
    trustRequired: false,
    status: 'ONLINE',
    latencyMs: 42,
    dockerVersion: '27.3.1',
    osName: 'Ubuntu 22.04.3 LTS',
    dockerErrorCode: null,
    errorCode: null,
    hostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
    checkedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CreateServerModal open onClose={() => undefined} workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

async function fillConnection(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Имя'), 'prod-x');
  await userEvent.type(screen.getByLabelText('Хост'), 'node.example.com');
  await userEvent.type(screen.getByLabelText('Пользователь SSH'), 'deploy');
  await userEvent.type(screen.getByLabelText('Пароль SSH'), 'sup3rsecret');
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('«Сохранить» отправляет create; без пробы пин не прикладывается', async () => {
  api.create.mockResolvedValue({} as never);
  renderModal();
  expect(
    screen.queryByRole('button', { name: 'Добавить сервер' }),
  ).not.toBeInTheDocument();

  await fillConnection();
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  expect(api.create).toHaveBeenCalledWith('ws-1', {
    name: 'prod-x',
    host: 'node.example.com',
    port: 22,
    sshUsername: 'deploy',
    authType: 'PASSWORD',
    sshPassword: 'sup3rsecret',
  });
});

test('тест-соединение: TOFU → «Доверять отпечатку» → пин уходит в create', async () => {
  const fingerprint = `SHA256:${'B'.repeat(43)}`;
  api.testConnection
    .mockResolvedValueOnce(
      result({
        reachable: false,
        trustRequired: true,
        errorCode: 'HOST_KEY_NOT_TRUSTED',
        hostKeyFingerprint: fingerprint,
        dockerVersion: null,
        osName: null,
      }),
    )
    .mockResolvedValueOnce(result({ hostKeyFingerprint: fingerprint }));
  api.create.mockResolvedValue({} as never);

  renderModal();
  await fillConnection();
  await userEvent.click(
    screen.getByRole('button', { name: 'Тестовое соединение' }),
  );
  expect(api.testConnection).toHaveBeenCalledWith('ws-1', {
    host: 'node.example.com',
    port: 22,
    sshUsername: 'deploy',
    authType: 'PASSWORD',
    sshPassword: 'sup3rsecret',
  });

  expect(await screen.findByText(fingerprint)).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Доверять отпечатку' }),
  );
  expect(api.testConnection).toHaveBeenLastCalledWith(
    'ws-1',
    expect.objectContaining({ trustHostKey: fingerprint }),
  );
  expect(
    await screen.findByText(/Соединение установлено: Docker 27\.3\.1/),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(api.create).toHaveBeenCalledWith(
    'ws-1',
    expect.objectContaining({ hostKeyFingerprint: fingerprint }),
  );
});

test('валидация до запроса; глазок переключает видимость пароля', async () => {
  renderModal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Тестовое соединение' }),
  );
  expect(api.testConnection).not.toHaveBeenCalled();
  expect(
    screen.getByText('Только строчные буквы, цифры, точка и дефис.'),
  ).toBeInTheDocument();

  const password = screen.getByLabelText('Пароль SSH');
  expect(password).toHaveAttribute('type', 'password');
  await userEvent.click(
    screen.getByRole('button', { name: 'Показать пароль' }),
  );
  expect(password).toHaveAttribute('type', 'text');
});
