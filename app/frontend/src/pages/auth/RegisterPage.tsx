import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useSession } from '../../auth/session';
import { errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { Spinner } from '../../ui/Spinner';
import { TextField } from '../../ui/TextField';
import { AuthLayout } from './AuthLayout';
import { AuthSocial } from './AuthSocial';
import { PasswordField } from './PasswordField';

interface AuthNavState {
  returnTo?: string;
}

const USERNAME_RE = /^[a-z0-9._-]{3,64}$/;

export function RegisterPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthNavState;

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    email?: string;
    password?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  if (session.sessionError) {
    return (
      <FullPage>
        <ErrorState
          title="Панель недоступна"
          description="Не удалось связаться с сервером панели."
          onRetry={session.reload}
        />
      </FullPage>
    );
  }

  if (session.status === 'checking') {
    return (
      <FullPage>
        <Spinner size={22} />
      </FullPage>
    );
  }

  if (session.status === 'authenticated') {
    return <Navigate to={state.returnTo ?? '/'} replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const next: { username?: string; email?: string; password?: string } = {};
    if (!USERNAME_RE.test(username)) {
      next.username = 'Введите имя пользователя';
    }
    if (
      normalizedEmail.length < 6 ||
      normalizedEmail.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(normalizedEmail)
    ) {
      next.email = 'Введите email';
    }
    if (
      password.length < 8 ||
      password.length > 128 ||
      /\s/.test(password)
    ) {
      next.password = 'Введите пароль';
    }
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setBusy(true);
    try {
      await authApi.register({
        username,
        email: normalizedEmail,
        password,
      });
      navigate('/login', {
        replace: true,
        state: { registered: normalizedEmail, returnTo: state.returnTo },
      });
    } catch (err) {
      // Дубликат аккаунта бэкенд отдаёт как 400 без текста (Bad Request) —
      // без этой ветки пользователь видел бы бессмысленное «Bad Request».
      if (err instanceof ApiError && err.status === 400 && err.message === 'Bad Request') {
        setError('Не удалось создать аккаунт: возможно, email или имя уже заняты.');
      } else {
        setError(errorText(err, 'generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Регистрация"
      footer={
        <>
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <AuthSocial />
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <TextField
          value={username}
          onChange={(event) => {
            setUsername(event.target.value.toLowerCase());
            setFieldErrors((prev) => ({ ...prev, username: undefined }));
          }}
          placeholder="Имя пользователя"
          aria-label="Имя пользователя"
          autoComplete="username"
          autoFocus
          required
          error={fieldErrors.username}
        />
        <TextField
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          placeholder="Адрес электронной почты"
          aria-label="Email"
          autoComplete="email"
          required
          error={fieldErrors.email}
        />
        <PasswordField
          value={password}
          onChange={(value) => {
            setPassword(value);
            setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="Пароль"
          ariaLabel="Пароль"
          autoComplete="new-password"
          required
          error={fieldErrors.password}
        />
        <Button
          type="submit"
          variant="primary"
          className="auth-submit"
          loading={busy}
        >
          Продолжить
        </Button>
      </form>
    </AuthLayout>
  );
}
