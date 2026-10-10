import { useEffect } from 'react';
import { Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { workspaceKeys } from '../../api/keys';
import { ApiError } from '../../api/client';
import { setLastWorkspaceId } from '../../api/lastWorkspace';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import './workspaces.css';

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });

  useEffect(() => {
    if (detail.data) setLastWorkspaceId(detail.data.id);
  }, [detail.data]);

  if (workspaceId === '') return <Navigate to="/workspaces" replace />;

  if (detail.isPending) {
    return (
      <div className="page">
        <Skeleton lines={2} />
      </div>
    );
  }

  if (detail.isError) {
    if (isUnauthorized(detail.error)) {
      // Сессия кончилась — редирект сделает слой сессии, не рисуем ошибку.
      return (
        <FullPage>
          <Spinner size={22} />
        </FullPage>
      );
    }
    const notFound =
      detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="page">
        <ErrorState
          title={notFound ? 'Пространство недоступно' : 'Не удалось загрузить пространство'}
          description={
            notFound
              ? 'Нет доступа или пространство удалено.'
              : errorText(detail.error)
          }
          onRetry={() => void detail.refetch()}
        />
        {notFound && (
          <div className="ws-back">
            <Button onClick={() => navigate('/workspaces')}>
              Ко всем пространствам
            </Button>
          </div>
        )}
      </div>
    );
  }

  return <Outlet />;
}
