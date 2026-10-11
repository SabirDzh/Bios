import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { usersApi } from '../../api/users';
import { SessionContext } from '../../auth/session';
import type { SessionValue } from '../../auth/session';
import { AccountPage } from './AccountPage';

vi.mock('../../api/users', () => ({
  usersApi: { changePassword: vi.fn() },
}));

const changePassword = vi.mocked(usersApi.changePassword);

const session: SessionValue = {
  status: 'authenticated',
  user: {
    userId: '01a127f4-0000-7000-8000-000000000001',
    username: 'deploy-bot',
    email: 'bot@example.com',
    sid: '01a127f4-1111-7000-8000-000000000002',
  },
  sessionError: false,
  login: vi.fn(),
  logout: vi.fn(),
  reload: vi.fn(),
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={['/account']}>
          <Routes>
            <Route path="/account" element={<AccountPage />} />
            <Route path="/login" element={<div>ЭКРАН ВХОДА</div>} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

function fillForm(values: { current?: string; next?: string; repeat?: string }): void {
  if (values.current !== undefined) {
    fireEvent.change(screen.getByLabelText('Текущий пароль'), {
      target: { value: values.current },
    });
  }
  if (values.next !== undefined) {
    fireEvent.change(screen.getByLabelText('Новый пароль'), {
      target: { value: values.next },
    });
  }
  if (values.repeat !== undefined) {
    fireEvent.change(screen.getByLabelText('Повтор нового пароля'), {
      target: { value: values.repeat },
    });
  }
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }));
}

beforeEach(() => {
  changePassword.mockReset();
});

test('профиль показывает имя, email и ID из сессии', () => {
  renderPage();
  expect(screen.getByText('deploy-bot')).toBeInTheDocument();
  expect(screen.getByText('bot@example.com')).toBeInTheDocument();
  expect(screen.getByText(session.user!.userId)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Выйти из аккаунта' })).toBeInTheDocument();
});

test('валидация по полям: запрос не уходит при ошибках', () => {
  renderPage();
  fillForm({ current: '', next: 'short', repeat: 'other' });
  submit();

  expect(screen.getByText('Введите текущий пароль.')).toBeInTheDocument();
  expect(
    screen.getByText('Новый пароль: 8–128 символов, без пробелов.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Повтор не совпадает с новым паролем.')).toBeInTheDocument();
  expect(changePassword).not.toHaveBeenCalled();
});

test('новый пароль не может совпадать с текущим', () => {
  renderPage();
  fillForm({ current: 'old-pass-1', next: 'old-pass-1', repeat: 'old-pass-1' });
  submit();

  expect(screen.getByText('Новый пароль совпадает с текущим.')).toBeInTheDocument();
  expect(changePassword).not.toHaveBeenCalled();
});

test('403: ошибка на поле «Текущий пароль», фокус возвращается туда', async () => {
  changePassword.mockRejectedValue(
    new ApiError(403, 'wrong password', { statusCode: 403 }),
  );
  renderPage();
  fillForm({ current: 'wrong-pass', next: 'new-pass-12', repeat: 'new-pass-12' });
  submit();

  expect(await screen.findByText('Неверный текущий пароль.')).toBeInTheDocument();
  expect(screen.getByLabelText('Текущий пароль')).toHaveFocus();
});

test('429 показывается общим Callout-ом, а не ошибкой поля', async () => {
  changePassword.mockRejectedValue(
    new ApiError(429, 'too many', { statusCode: 429 }),
  );
  renderPage();
  fillForm({ current: 'old-pass-1', next: 'new-pass-12', repeat: 'new-pass-12' });
  submit();

  expect(
    await screen.findByText('Слишком много попыток. Подождите минуту.'),
  ).toBeInTheDocument();
});

test('успех: переход на вход (пароль сменился, сессии отозваны)', async () => {
  changePassword.mockResolvedValue(undefined);
  renderPage();
  fillForm({ current: 'old-pass-1', next: 'new-pass-12', repeat: 'new-pass-12' });
  submit();

  await waitFor(() => expect(screen.getByText('ЭКРАН ВХОДА')).toBeInTheDocument());
  expect(changePassword).toHaveBeenCalledWith({
    password: 'old-pass-1',
    newPassword: 'new-pass-12',
  });
});
