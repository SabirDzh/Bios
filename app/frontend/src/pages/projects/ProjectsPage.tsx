import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2, Plus, RefreshCw } from 'lucide-react';
import { workspacesApi } from '../../api/workspaces';
import { workspaceKeys } from '../../api/keys';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { plural } from '../../lib/format';
import { Button } from '../../ui/Button';
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
import { CreateProjectModal } from './CreateProjectModal';
import { useProjectList } from './projects.queries';
import './projects.css';

export function ProjectsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const [createOpen, setCreateOpen] = useState(false);

  // detail уже в кэше: WorkspaceLayout грузит его до рендера Outlet.
  const detail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });
  const list = useProjectList(workspaceId);

  const isOwner = detail.data?.role === 'OWNER';

  const addButton = isOwner ? (
    <Button
      variant="primary"
      icon={<Plus size={14} aria-hidden />}
      onClick={() => setCreateOpen(true)}
    >
      Добавить проект
    </Button>
  ) : null;

  if (list.isPending) {
    return (
      <div className="page">
        <PageHeader title="Проекты" actions={addButton} />
        <div className="pj-skeleton">
          <Skeleton lines={3} />
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
        <PageHeader title="Проекты" actions={addButton} />
        <div className="pj-skeleton">
          <ErrorState
            description={errorText(list.error)}
            onRetry={() => void list.refetch()}
          />
        </div>
      </div>
    );
  }

  if (list.data.length === 0) {
    return (
      <div className="page">
        <PageHeader title="Проекты" actions={addButton} />
        <div className="pj-empty">
          <EmptyState
            icon={<FolderGit2 size={22} aria-hidden />}
            title="Проектов пока нет"
            description={
              isOwner
                ? 'Добавьте публичный Git-репозиторий — в нём панель будет собирать контейнеры по конфигам деплоя.'
                : 'Первый проект создаёт владелец пространства.'
            }
            action={
              isOwner ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Добавить проект
                </Button>
              ) : undefined
            }
          />
        </div>
        <CreateProjectModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          workspaceId={workspaceId}
        />
      </div>
    );
  }

  const refetching = list.isFetching && !list.isPending;
  const total = list.data.length;

  return (
    <div className="page">
      <PageHeader title="Проекты" actions={addButton} />
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
        {total} {plural(total, 'проект', 'проекта', 'проектов')}
      </Toolbar>
      <Table className="stagger">
        <thead>
          <tr>
            <th>Проект</th>
            <th>Создан</th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((project, idx) => (
            <tr key={project.id} style={{ '--i': idx } as CSSProperties}>
              <td className="ellipsis" title={project.name}>
                <Link
                  className="pj-link pj-title"
                  to={`/w/${workspaceId}/projects/${project.id}`}
                >
                  {project.name}
                </Link>
                <div className="pj-repo mono" title={project.repoUrl}>
                  {project.repoUrl}
                </div>
              </td>
              <td>
                <Timestamp iso={project.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
      />
    </div>
  );
}
