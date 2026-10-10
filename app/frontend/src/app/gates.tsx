import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../auth/session';
import { ErrorState } from '../ui/ErrorState';
import { FullPage } from '../ui/FullPage';
import { Spinner } from '../ui/Spinner';

export function RequireSession() {
  const session = useSession();
  const location = useLocation();

  if (session.sessionError) {
    return (
      <FullPage>
        <ErrorState
          title="Панель недоступна"
          description="Не удалось проверить сессию — сервер панели не отвечает."
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

  if (session.status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search }}
      />
    );
  }

  return <Outlet />;
}
