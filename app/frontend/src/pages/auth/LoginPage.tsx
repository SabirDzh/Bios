import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useSession } from '../../auth/session';
import { errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { Spinner } from '../../ui/Spinner';
import { TextField } from '../../ui/TextField';
import { AuthLayout } from './AuthLayout';

interface AuthNavState {
  returnTo?: string;
  registered?: string;
  notice?: string;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthNavState;

  const [email, setEmail] = useState(state.registered ?? '');
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
    if (!email.trim() || !password) {
      setError('Заполните email и пароль.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await session.login({ email: email.trim(), password });
      navigate(state.returnTo ?? '/', { replace: true });
    } catch (err) {
      setError(errorText(err, 'login'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Вход"
      footer={
        <>
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        {(state.notice || state.registered) && !error && (
          <div className="auth-notice">
            {state.notice ?? 'Аккаунт создан. Войдите с указанным email.'}
          </div>
        )}
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
        <TextField
          label="Пароль"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        <Button
          type="submit"
          variant="primary"
          className="auth-submit"
          loading={busy}
        >
          Войти
        </Button>
      </form>
    </AuthLayout>
  );
}
