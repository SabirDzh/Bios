import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw, Rocket, Anvil } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { workspacesApi } from '../../api/workspaces';
import { ApiError } from '../../api/client';
import { deploymentKeys, workspaceKeys } from '../../api/keys';
import type { DeployConfig } from '../../api/types';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { plural } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { IconButton } from '../../ui/IconButton';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { Table } from '../../ui/Table';
import { Timestamp } from '../../ui/Timestamp';
import { Toolbar } from '../../ui/Toolbar';
import { CreateConfigModal } from './CreateConfigModal';
import {
  serverNameOf,
  useProject,
  useProjectConfigs,
  useServerOptions,
} from './projects.queries';
import './projects.css';

function ConfigServer({ serverId, name }: { serverId: string; name: string | null }) {
  if (name) return <span className="ellipsis pj-server" title={name}>{name}</span>;
  // Сервер мог быть удалён или не попасть в первую страницу — id честнее пустоты.
  return (
    <span className="mono" title={serverId}>
      {serverId.slice(0, 8)}…
    </span>
  );
}

export function ProjectPage() {
  const { workspaceId = '', projectId = '' } = useParams<{
    workspaceId: string;
    projectId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });
  const project = useProject(workspaceId, projectId);
  const configs = useProjectConfigs(workspaceId, projectId);
  const servers = useServerOptions(workspaceId);

  const [createOpen, setCreateOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const cooling = cooldownUntil > clock;

  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const launch = useMutation({
    mutationFn: (configId: string) =>
      deploymentsApi.create(workspaceId, { projectId, configId }),
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

  const isOwner = detail.data?.role === 'OWNER';

  if (project.isPending) {
    return (
      <div className="page">
        <PageHeader title="…" />
        <div className="pj-skeleton">
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  if (project.isError) {
    if (isUnauthorized(project.error)) {
      return (
        <FullPage>
          <Spinner size={22} />
        </FullPage>
      );
    }
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="page">
        <PageHeader title="…" />
        <div className="pj-skeleton">
          {notFound ? (
            <ErrorState
              title="Проект не найден"
              description={
                <span>
                  Проект удалён или недоступен.{' '}
                  <Link to={`/w/${workspaceId}/projects`}>
                    Вернуться к проектам
                  </Link>
                  .
                </span>
              }
            />
          ) : (
            <ErrorState
              description={errorText(project.error)}
              onRetry={() => void project.refetch()}
            />
          )}
        </div>
      </div>
    );
  }

  const configRows: DeployConfig[] = configs.data ?? [];
  const serverItems = servers.data?.items ?? [];
  const refetching = configs.isFetching && !configs.isPending && !configs.isError;
  const secsLeft = cooling
    ? Math.max(1, Math.ceil((cooldownUntil - clock) / 1000))
    : 0;

  const addButton = isOwner ? (
    <Button
      variant="primary"
      icon={<Plus size={14} aria-hidden />}
      onClick={() => setCreateOpen(true)}
    >
      Добавить конфиг
    </Button>
  ) : null;

  return (
    <div className="page">
      <PageHeader
        title={project.data.name}
       
        meta={
          <>
            <span className="mono pj-meta-url" title={project.data.repoUrl}>
              {project.data.repoUrl}
            </span>
            <span className="pj-meta-sep">·</span>
            <Timestamp iso={project.data.createdAt} />
          </>
        }
        actions={
          <>
            <IconButton
              label="Обновить"
              icon={<RefreshCw size={14} aria-hidden />}
              onClick={() => void configs.refetch()}
              disabled={configs.isFetching}
            />
            {addButton}
          </>
        }
      />

      <div className="pj-feedback">
        {cooling ? (
          <Callout tone="warn">
            Слишком много SSH-операций — панель разрешает 6 в минуту. Запустить
            деплой можно через {secsLeft} с.
          </Callout>
        ) : (
          launchError && <Callout tone="warn">{launchError}</Callout>
        )}
      </div>

      {configs.isPending ? (
        <div className="pj-skeleton">
          <Skeleton lines={3} />
        </div>
      ) : configs.isError ? (
        <ErrorState
          description={errorText(configs.error)}
          onRetry={() => void configs.refetch()}
        />
      ) : configRows.length === 0 ? (
        <EmptyState
          icon={<Anvil size={22} aria-hidden />}
          title="Конфигов пока нет"
          description={
            isOwner
              ? 'Конфиг описывает, что собирать: ветка, Dockerfile, имя контейнера и порты.'
              : 'Конфиги создаёт владелец пространства.'
          }
          action={
            isOwner ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Добавить конфиг
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Toolbar busy={refetching}>
            {configRows.length}{' '}
            {plural(configRows.length, 'конфиг', 'конфига', 'конфигов')}
          </Toolbar>
          <Table className="stagger">
            <thead>
              <tr>
                <th>Конфиг</th>
                <th>Сервер</th>
                <th>Ветка</th>
                <th>Контейнер</th>
                <th>Порты</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {configRows.map((config, idx) => {
                const busyRow =
                  launch.isPending && launch.variables === config.id;
                return (
                  <tr key={config.id} style={{ '--i': idx } as CSSProperties}>
                    <td className="ellipsis pj-name" title={config.name}>
                      <Link
                        className="pj-link pj-title"
                        to={`/w/${workspaceId}/deploys?project=${projectId}&config=${config.id}`}
                      >
                        {config.name}
                      </Link>
                    </td>
                    <td className="ellipsis pj-server-cell">
                      <ConfigServer
                        serverId={config.serverId}
                        name={serverNameOf(serverItems, config.serverId)}
                      />
                    </td>
                    <td className="mono">{config.ref}</td>
                    <td className="mono ellipsis pj-container" title={config.containerName}>
                      {config.containerName}
                    </td>
                    <td className="mono">
                      {config.ports.length > 0 ? (
                        config.ports.join(' · ')
                      ) : (
                        <span className="pj-empty-cell">—</span>
                      )}
                    </td>
                    <td className="pj-actions">
                      {isOwner && (
                        <Button
                          size="sm"
                          variant="primary"
                          className={busyRow ? 'is-busy' : undefined}
                          disabled={launch.isPending || cooling}
                          icon={
                            busyRow ? (
                              <Loader2 size={12} className="spin" aria-hidden />
                            ) : (
                              <Rocket size={12} aria-hidden />
                            )
                          }
                          title="Запустить деплой"
                          onClick={() => launch.mutate(config.id)}
                        >
                          Запустить
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <CreateConfigModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        projectId={projectId}
      />
    </div>
  );
}
