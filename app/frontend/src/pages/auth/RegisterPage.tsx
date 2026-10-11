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
import { PasswordField } from './PasswordField';

interface AuthNavState {
  returnTo?: string;
}

const USERNAME_RE = /^[a-z0-9._-]{3,64}$/;

function validate(username: string, email: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return 'Имя: 3–64 символа — латиница, цифры, точка, дефис, подчёркивание.';
  }
  if (email.length < 6 || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return 'Укажите корректный email.';
  }
  if (password.length < 8 || password.length > 128 || /\s/.test(password)) {
    return 'Пароль: 8–128 символов, без пробелов.';
  }
  return null;
}

export function RegisterPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthNavState;

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    const validationError = validate(username, normalizedEmail, password);
    if (validationError) {
      setError(validationError);
      return;
    }
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
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <TextField
          value={username}
          onChange={(event) => setUsername(event.target.value.toLowerCase())}
          placeholder="Имя пользователя"
          aria-label="Имя пользователя"
          autoComplete="username"
          autoFocus
          required
        />
        <TextField
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Адрес электронной почты"
          aria-label="Email"
          autoComplete="email"
          required
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder="Пароль"
          ariaLabel="Пароль"
          autoComplete="new-password"
          required
        />
        <Button
          type="submit"
          variant="primary"
          className="auth-submit"
          loading={busy}
        >
          Создать аккаунт
        </Button>
      </form>
    </AuthLayout>
  );
}
