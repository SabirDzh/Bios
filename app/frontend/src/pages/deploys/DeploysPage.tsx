import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { CSSProperties, KeyboardEvent } from 'react';
import { RefreshCw, Rocket } from 'lucide-react';
import type { Deployment } from '../../api/types';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { formatDuration, plural } from '../../lib/format';
import { deploymentStatus } from '../../lib/statusMeta';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { IconButton } from '../../ui/IconButton';
import { PageHeader } from '../../ui/PageHeader';
import { Select } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { StatusBadge } from '../../ui/StatusBadge';
import { Table } from '../../ui/Table';
import { Timestamp } from '../../ui/Timestamp';
import { Toolbar } from '../../ui/Toolbar';
import { useConfigNames, useDeploymentList } from './deploys.queries';
import { useProjectConfigs, useProjectList } from '../projects/projects.queries';
import './deploys.css';

const LIMIT = 50;

export function DeploysPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Фильтры живут в URL (IA §2, фасеты): ссылку из проекта можно расшарить.
  const projectFilter = searchParams.get('project') ?? '';
  const configFilter = searchParams.get('config') ?? '';

  const projects = useProjectList(workspaceId);
  const list = useDeploymentList(workspaceId, {
    projectId: projectFilter || undefined,
    configId: configFilter || undefined,
    limit: LIMIT,
  });
  // Конфиги нужны для Select-а; когда проект не выбран, запрос выключен.
  const projectConfigs = useProjectConfigs(workspaceId, projectFilter);

  const deployments: Deployment[] = list.data ?? [];
  const distinctProjectIds = [...new Set(deployments.map((d) => d.projectId))];
  const configNames = useConfigNames(workspaceId, distinctProjectIds);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  function applyFilters(nextProject: string, nextConfig: string): void {
    const next = new URLSearchParams(searchParams);
    if (nextProject) next.set('project', nextProject);
    else next.delete('project');
    if (nextConfig) next.set('config', nextConfig);
    else next.delete('config');
    setSearchParams(next, { replace: true });
  }

  const filtersActive = projectFilter !== '' || configFilter !== '';

  if (list.isPending) {
    return (
      <div className="page">
        <PageHeader title="Деплои" />
        <div className="dp-skeleton">
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  if (list.isError) {
    if (isUnauthorized(list.error)) {
      return (
        <FullPage>
          <Spinner size={22} />
        </FullPage>
      );
    }
    return (
      <div className="page">
        <PageHeader title="Деплои" />
        <div className="dp-skeleton">
          <ErrorState
            description={errorText(list.error)}
            onRetry={() => void list.refetch()}
          />
        </div>
      </div>
    );
  }

  const refetching = list.isFetching && !list.isPending;
  const total = deployments.length;
  const countText =
    total >= LIMIT
      ? `Последние ${total}`
      : `${total} ${plural(total, 'деплой', 'деплоя', 'деплоев')}`;

  return (
    <div className="page">
      <PageHeader title="Деплои" />
      <Toolbar
        busy={refetching}
        actions={
          <IconButton
            label="Обновить"
            icon={<RefreshCw size={14} aria-hidden />}
            onClick={() => void list.refetch()}
            disabled={list.isFetching}
          />
        }
      >
        {countText}
      </Toolbar>
      <div className="dp-filters">
        <div className="dp-filter">
          <Select
            label="Проект"
            value={projectFilter}
            onChange={(event) => applyFilters(event.target.value, '')}
          >
            <option value="">Все проекты</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="dp-filter">
          <Select
            label="Конфиг"
            value={configFilter}
            onChange={(event) => applyFilters(projectFilter, event.target.value)}
            disabled={projectFilter === ''}
            hint={projectFilter === '' ? 'Сначала выберите проект' : undefined}
          >
            <option value="">Все конфиги</option>
            {(projectConfigs.data ?? []).map((config) => (
              <option key={config.id} value={config.id}>
                {config.name}
              </option>
            ))}
          </Select>
        </div>
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            className="dp-reset"
            onClick={() => applyFilters('', '')}
          >
            Сбросить
          </Button>
        )}
      </div>
      {deployments.length === 0 ? (
        <div className="dp-empty">
          {filtersActive ? (
            <EmptyState
              icon={<Rocket size={22} aria-hidden />}
              title="По фильтру ничего нет"
              description="Среди последних деплоев нет записей с такими проектом и конфигом."
            />
          ) : (
            <EmptyState
              icon={<Rocket size={22} aria-hidden />}
              title="Деплоев пока нет"
              description="Первый деплой запускается со страницы проекта — кнопкой «Запустить» у конфига."
              action={
                <Button
                  variant="primary"
                  onClick={() => navigate(`/w/${workspaceId}/projects`)}
                >
                  Перейти к проектам
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <>
          <Table className="stagger">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Деплой</th>
                <th>Конфиг</th>
                <th>Проект</th>
                <th>Коммит</th>
                <th>Запущен</th>
                <th className="numeric">Длительность</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((deployment, idx) => (
                <tr
                  key={deployment.id}
                  className="dp-row"
                  style={{ '--i': idx } as CSSProperties}
                  tabIndex={0}
                  onClick={(event) => {
                    // Клик по ссылкам и кнопкам внутри строки не перехватываем.
                    if ((event.target as Element).closest('a,button')) return;
                    navigate(`/w/${workspaceId}/deploys/${deployment.id}`);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    navigate(`/w/${workspaceId}/deploys/${deployment.id}`);
                  }}
                >
                  <td>
                    <StatusBadge meta={deploymentStatus(deployment.status)} />
                  </td>
                  <td className="mono">
                    <Link
                      className="dp-link"
                      to={`/w/${workspaceId}/deploys/${deployment.id}`}
                    >
                      #{deployment.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td
                    className="ellipsis dp-config"
                    title={configNames.get(deployment.configId)}
                  >
                    {configNames.get(deployment.configId) ?? (
                      <span className="mono dp-unknown" title={deployment.configId}>
                        {deployment.configId.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td
                    className="ellipsis dp-project"
                    title={projectNames.get(deployment.projectId)}
                  >
                    {projectNames.get(deployment.projectId) ?? '—'}
                  </td>
                  <td className="mono">
                    {deployment.commitSha ? (
                      deployment.commitSha.slice(0, 8)
                    ) : (
                      <span className="dp-empty-cell">—</span>
                    )}
                  </td>
                  <td>
                    <Timestamp iso={deployment.createdAt} />
                  </td>
                  <td className="numeric">
                    {deployment.durationMs !== null ? (
                      formatDuration(deployment.durationMs)
                    ) : (
                      <span className="dp-empty-cell">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="dp-note">История — последние {LIMIT} деплоев.</p>
        </>
      )}
    </div>
  );
}
