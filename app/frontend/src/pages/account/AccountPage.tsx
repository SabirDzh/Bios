import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/users';
import { ApiError } from '../../api/client';
import { useSession } from '../../auth/session';
import { errorText } from '../../errors/errorText';
import { getThemeMode, setThemeMode, type ThemeMode } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import './account.css';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'Системная' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
];

export function AccountPage() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  const change = useMutation({
    mutationFn: (values: { password: string; newPassword: string }) =>
      usersApi.changePassword(values),
    onSuccess: () => {
      // Смена пароля отозвала сессии и очистила куки — возвращаемся на вход.
      queryClient.clear();
      navigate('/login', {
        replace: true,
        state: { notice: 'Пароль изменён. Войдите с новым паролем.' },
      });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setError('Неверный текущий пароль.');
      } else {
        setError(errorText(err, 'generic'));
      }
    },
  });

  function submitPassword(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (password === '') {
      setError('Введите текущий пароль.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128 || /\s/.test(newPassword)) {
      setError('Новый пароль: 8–128 символов, без пробелов.');
      return;
    }
    if (newPassword !== repeat) {
      setError('Новый пароль и повтор не совпадают.');
      return;
    }
    if (newPassword === password) {
      setError('Новый пароль совпадает с текущим.');
      return;
    }
    setError(null);
    change.mutate({ password, newPassword });
  }

  async function logout(): Promise<void> {
    await session.logout();
    navigate('/login');
  }

  return (
    <div className="page">
      <h1>Аккаунт</h1>

      <section className="acc-section">
        <h2>Профиль</h2>
        <dl className="acc-profile">
          <dt>Имя</dt>
          <dd className="mono">{session.user?.username}</dd>
          <dt>Email</dt>
          <dd className="mono">{session.user?.email}</dd>
        </dl>
      </section>

      <section className="acc-section">
        <h2>Пароль</h2>
        <form className="acc-form" onSubmit={submitPassword} noValidate>
          {error && (
            <div className="ws-form-error" role="alert">
              {error}
            </div>
          )}
          <TextField
            label="Текущий пароль"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <TextField
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            hint="8–128 символов, без пробелов"
            autoComplete="new-password"
            required
          />
          <TextField
            label="Повтор нового пароля"
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            required
          />
          <div>
            <Button type="submit" variant="primary" loading={change.isPending}>
              Сменить пароль
            </Button>
          </div>
          <p className="muted-note">
            Смена пароля завершает все активные сессии — потребуется войти заново.
          </p>
        </form>
      </section>

      <section className="acc-section">
        <h2>Оформление</h2>
        <div className="acc-theme" role="radiogroup" aria-label="Тема оформления">
          {THEME_OPTIONS.map((option) => (
            <label key={option.value} className="acc-theme-option">
              <input
                type="radio"
                name="theme-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  setThemeMode(option.value);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="acc-section">
        <h2>Сессия</h2>
        <Button onClick={() => void logout()}>Выйти из аккаунта</Button>
      </section>
    </div>
  );
}
