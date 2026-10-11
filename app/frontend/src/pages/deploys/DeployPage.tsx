import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCw } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { workspacesApi } from '../../api/workspaces';
import { ApiError } from '../../api/client';
import { deploymentKeys, workspaceKeys } from '../../api/keys';
import { codeText, errorText, isUnauthorized } from '../../errors/errorText';
import { formatDuration } from '../../lib/format';import { deploymentStatus } from '../../lib/statusMeta';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { CopyButton } from '../../ui/CopyButton';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { IconButton } from '../../ui/IconButton';
import { LogPanel } from '../../ui/LogPanel';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { StatusBadge } from '../../ui/StatusBadge';
import { StepProgress } from '../../ui/StepProgress';
import { Timestamp } from '../../ui/Timestamp';
import { isFinished, useDeployment, useDeploymentLogs } from './deploys.queries';
import { useProject, useProjectConfigs } from '../projects/projects.queries';
import './deploys.css';

const POLL_MS = 2000;

export function DeployPage() {
  const { workspaceId = '', deploymentId = '' } = useParams<{
    workspaceId: string;
    deploymentId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [paused, setPaused] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const detailWorkspace = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });
  const detail = useDeployment(workspaceId, deploymentId, {
    pollMs: paused ? null : POLL_MS,
  });
  const finished = isFinished(detail.data?.status);
  const logs = useDeploymentLogs(workspaceId, deploymentId, {
    pollMs: paused || finished ? null : POLL_MS,
  });

  const projectId = detail.data?.projectId ?? '';
  const project = useProject(workspaceId, projectId);
  const configs = useProjectConfigs(workspaceId, projectId);
  const config = configs.data?.find((row) => row.id === detail.data?.configId);

  const cooling = cooldownUntil > clock;
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const relaunch = useMutation({
    mutationFn: (vars: { projectId: string; configId: string }) =>
      deploymentsApi.create(workspaceId, vars),
    onMutate: () => setLaunchError(null),
    onSuccess: (deployment) => {
      void queryClient.invalidateQueries({ queryKey: deploymentKeys.all });
      navigate(`/w/${workspaceId}/deploys/${deployment.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 429) {
        setClock(Date.now());
        setCooldownUntil(Date.now() + 60_000);
        return;
      }
      setLaunchError(errorText(err, 'deploy'));
    },
  });

  const shortId = deploymentId.slice(0, 8);
  const isOwner = detailWorkspace.data?.role === 'OWNER';

  if (detail.isPending) {
    return (
      <div className="page">
        <PageHeader title={`Деплой #${shortId}`} />
        <div className="dp-skeleton">
          <Skeleton lines={5} />
        </div>
      </div>
    );
  }

  if (detail.isError) {
    if (isUnauthorized(detail.error)) {
      return (
        <FullPage>
          <Spinner size={22} />
        </FullPage>
      );
    }
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="page">
        <PageHeader title={`Деплой #${shortId}`} />
        <div className="dp-skeleton">
          {notFound ? (
            <ErrorState
              title="Деплой не найден"
              description={
                <span>
                  Запись удалена или недоступна.{' '}
                  <Link to={`/w/${workspaceId}/deploys`}>Вернуться к деплоям</Link>.
                </span>
              }
            />
          ) : (
            <ErrorState
              description={errorText(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          )}
        </div>
      </div>
    );
  }

  const data = detail.data;
  const refreshing = detail.isFetching || logs.isFetching;
  const secsLeft = cooling
    ? Math.max(1, Math.ceil((cooldownUntil - clock) / 1000))
    : 0;
  const code = data.errorCode;

  function refreshAll(): void {
    void detail.refetch();
    void logs.refetch();
  }

  return (
    <div className="page dp-page">
      <PageHeader
        title={config ? config.name : `Деплой #${shortId}`}
       
        meta={
          <>
            <StatusBadge meta={deploymentStatus(data.status)} />
            <span className="dp-meta-sep">·</span>
            <Link className="dp-link" to={`/w/${workspaceId}/projects/${data.projectId}`}>
              {project.data?.name ?? 'проект'}
            </Link>
            <span className="dp-meta-sep">·</span>
            <Timestamp iso={data.createdAt} />
          </>
        }
        actions={
          <>
            <IconButton
              label="Обновить"
              icon={<RefreshCw size={14} aria-hidden />}
              onClick={refreshAll}
              disabled={refreshing}
            />
            {isOwner && (
              <Button
                variant="primary"
                icon={<RotateCw size={14} aria-hidden />}
                loading={relaunch.isPending}
                disabled={cooling}
                onClick={() =>
                  relaunch.mutate({
                    projectId: data.projectId,
                    configId: data.configId,
                  })
                }
              >
                Запустить снова
              </Button>
            )}
          </>
        }
      />

      <div className="dp-tech">
        <span className="dp-tech-item">
          <span className="dp-tech-label">Коммит</span>
          {data.commitSha ? (
            <>
              <code className="mono" title={data.commitSha}>
                {data.commitSha.slice(0, 8)}
              </code>
              <CopyButton value={data.commitSha} />
            </>
          ) : (
            <span className="dp-empty-cell">—</span>
          )}
        </span>
        <span className="dp-tech-item">
          <span className="dp-tech-label">Образ</span>
          {data.imageTag ? (
            <>
              <code className="mono">{data.imageTag}</code>
              <CopyButton value={data.imageTag} />
            </>
          ) : (
            <span className="dp-empty-cell">—</span>
          )}
        </span>
        <span className="dp-tech-item">
          <span className="dp-tech-label">Контейнер</span>
          {data.containerId ? (
            <code className="mono" title={data.containerId}>
              {data.containerId.slice(0, 12)}
            </code>
          ) : (
            <span className="dp-empty-cell">—</span>
          )}
        </span>
        <span className="dp-tech-item">
          <span className="dp-tech-label">Длительность</span>
          {data.durationMs !== null ? (
            <span className="dp-num">{formatDuration(data.durationMs)}</span>
          ) : data.status === 'RUNNING' ? (
            'идёт'
          ) : (
            <span className="dp-empty-cell">—</span>
          )}
        </span>
        <span className="dp-tech-item">
          <span className="dp-tech-label">Завершён</span>
          {data.finishedAt ? (
            <Timestamp iso={data.finishedAt} />
          ) : (
            <span className="dp-empty-cell">—</span>
          )}
        </span>
      </div>

      <div className="dp-steps">
        <StepProgress step={data.step} status={data.status} />
      </div>

      <div className="dp-feedback">
        {cooling ? (
          <Callout tone="warn">
            Слишком много SSH-операций — панель разрешает 6 в минуту. Повторить
            можно через {secsLeft} с.
          </Callout>
        ) : launchError ? (
          <Callout tone="warn">{launchError}</Callout>
        ) : data.status === 'QUEUED' ? (
          <Callout tone="info">
            Деплой в очереди: исполнитель возьмёт задачу автоматически.
          </Callout>
        ) : data.status === 'FAILED' ? (
          <Callout tone="danger">
            {code
              ? codeText(code) ?? 'Деплой завершился с ошибкой.'
              : 'Деплой завершился с ошибкой.'}
            {code && (
              <>
                {' '}
                <span className="mono">({code})</span>
              </>
            )}
            {data.exitCode !== null && (
              <>
                {' '}
                · код выхода <span className="mono">{data.exitCode}</span>
              </>
            )}
          </Callout>
        ) : data.status === 'INTERRUPTED' ? (
          <Callout tone="warn">
            {code ? codeText(code) ?? 'Деплой прерван.' : 'Деплой прерван.'}
            {code && (
              <>
                {' '}
                <span className="mono">({code})</span>
              </>
            )}
          </Callout>
        ) : null}
      </div>

      <LogPanel
        key={deploymentId}
        className="dp-log"
        log={logs.data?.log}
        sizeBytes={logs.data?.sizeBytes}
        finished={finished}
        paused={paused}
        onTogglePause={() => setPaused((value) => !value)}
        onRefresh={refreshAll}
        refreshing={logs.isFetching}
      />
    </div>
  );
}
