import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/users';
import { ApiError } from '../../api/client';
import { useSession } from '../../auth/session';
import { errorText } from '../../errors/errorText';
import { getThemeMode, setThemeMode, type ThemeMode } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { PageHeader } from '../../ui/PageHeader';
import { TextField } from '../../ui/TextField';
import './account.css';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'Системная' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
];

interface PasswordErrors {
  current?: string;
  next?: string;
  repeat?: string;
}

export function AccountPage() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [fieldErrors, setFieldErrors] = useState<PasswordErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
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
        // Ошибка адресная: подсвечиваем поле и возвращаем в него фокус.
        setFieldErrors({ current: errorText(err, 'passwordChange') });
        currentRef.current?.focus();
        return;
      }
      setFormError(errorText(err, 'passwordChange'));
    },
  });

  function submitPassword(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const found: PasswordErrors = {};
    if (password === '') {
      found.current = 'Введите текущий пароль.';
    }
    if (
      newPassword.length < 8 ||
      newPassword.length > 128 ||
      /\s/.test(newPassword)
    ) {
      found.next = 'Новый пароль: 8–128 символов, без пробелов.';
    } else if (newPassword === password) {
      found.next = 'Новый пароль совпадает с текущим.';
    }
    if (repeat !== newPassword) {
      found.repeat = 'Повтор не совпадает с новым паролем.';
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    setFormError(null);
    change.mutate({ password, newPassword });
  }

  async function logout(): Promise<void> {
    await session.logout();
    navigate('/login');
  }

  return (
    <div className="page">
      <PageHeader title="Аккаунт" />

      <section className="acc-section">
        <h2>Профиль</h2>
        <dl className="acc-profile">
          <dt>Имя</dt>
          <dd className="mono">{session.user?.username ?? '—'}</dd>
          <dt>Email</dt>
          <dd className="mono">{session.user?.email ?? '—'}</dd>
          <dt>ID</dt>
          <dd className="mono" title={session.user?.userId}>
            {session.user?.userId ?? '—'}
          </dd>
        </dl>
        <p className="muted-note">Имя и email задаются при регистрации.</p>
      </section>

      <section className="acc-section">
        <h2>Пароль</h2>
        <form className="acc-form" onSubmit={submitPassword} noValidate>
          {formError && <Callout tone="danger">{formError}</Callout>}
          <TextField
            label="Текущий пароль"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.current ?? null}
            autoComplete="current-password"
            ref={currentRef}
            required
          />
          <TextField
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={fieldErrors.next ?? null}
            hint="8–128 символов, без пробелов"
            autoComplete="new-password"
            required
          />
          <TextField
            label="Повтор нового пароля"
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            error={fieldErrors.repeat ?? null}
            autoComplete="new-password"
            required
          />
          <div className="acc-form-actions">
            <Button type="submit" variant="primary" loading={change.isPending}>
              Сменить пароль
            </Button>
          </div>
          <p className="muted-note">
            Смена пароля завершает все активные сессии — потребуется войти
            заново.
          </p>
        </form>
      </section>

      <section className="acc-section">
        <h2>Сессия</h2>
        <Button onClick={() => void logout()}>Выйти из аккаунта</Button>
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
        <p className="muted-note">Тема хранится на этом устройстве.</p>
      </section>
    </div>
  );
}
