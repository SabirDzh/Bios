import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Layers, Plus } from 'lucide-react';
import { workspacesApi } from '../../api/workspaces';
import { setLastWorkspaceId } from '../../api/lastWorkspace';
import type { Workspace } from '../../api/types';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { formatDate } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { LoadMore } from '../../ui/LoadMore';
import { Modal } from '../../ui/Modal';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { TextField } from '../../ui/TextField';
import { Timestamp } from '../../ui/Timestamp';
import { useWorkspaceList } from './workspaces.queries';
import './workspaces.css';

const NAME_RE = /^[\p{L}\p{N} _#-]{1,64}$/u;

function RoleChip({ role }: { role: Workspace['role'] }) {
  return role === 'OWNER' ? (
    <Chip tone="accent">владелец</Chip>
  ) : (
    <Chip tone="neutral">участник</Chip>
  );
}

function CreateWorkspaceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (value: string) => workspacesApi.create({ name: value }),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setLastWorkspaceId(workspace.id);
      setName('');
      setError(null);
      onClose();
      navigate(`/w/${workspace.id}`);
    },
    onError: (err) => setError(errorText(err, 'generic')),
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = name.trim();
    if (!NAME_RE.test(value)) {
      setError('Только буквы, цифры, пробел и - _ # (1–64 символа).');
      return;
    }
    setError(null);
    create.mutate(value);
  }

  return (
    <Modal open={open} onClose={onClose} title="Новое пространство">
      <form className="ws-form" onSubmit={submit} noValidate>
        {error && (
          <div className="ws-form-error" role="alert">
            {error}
          </div>
        )}
        <TextField
          label="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Только буквы, цифры, пробел и - _ #"
          autoFocus
          required
        />
        <div className="ws-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Создать
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkspacesPage() {
  const list = useWorkspaceList();
  const [createOpen, setCreateOpen] = useState(false);

  if (list.isPending) {
    return (
      <div className="page">
        <h1>Пространства</h1>
        <div className="ws-skeleton">
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
        <h1>Пространства</h1>
        <div className="ws-skeleton">
          <ErrorState
            description={errorText(list.error)}
            onRetry={() => void list.refetch()}
          />
        </div>
      </div>
    );
  }

  if (list.workspaces.length === 0) {
    return (
      <div className="page">
        <h1>Пространства</h1>
        <div className="ws-empty">
          <EmptyState
            icon={<Layers size={22} aria-hidden />}
            title="Начните с пространства"
            description="Пространство объединяет серверы, проекты и деплои. Создайте первое — к нему потом добавите сервер по SSH."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Создать пространство
              </Button>
            }
          />
        </div>
        <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="ws-header">
        <h1>Пространства</h1>
        <Button
          variant="primary"
          icon={<Plus size={14} aria-hidden />}
          onClick={() => setCreateOpen(true)}
        >
          Создать
        </Button>
      </div>
      <ul className="ws-grid stagger">
        {list.workspaces.map((workspace, idx) => (
          <li key={workspace.id} style={{ '--i': idx } as CSSProperties}>
            <Link className="ws-card" to={`/w/${workspace.id}`}>
              <div className="ws-card-top">
                <h2 className="ws-card-name" title={workspace.name}>
                  {workspace.name}
                </h2>
                <ArrowUpRight className="ws-card-arrow" size={14} aria-hidden />
              </div>
              <div className="ws-card-meta">
                <RoleChip role={workspace.role} />
                <span>создано {formatDate(workspace.createdAt)}</span>
                <span>
                  обновлено <Timestamp iso={workspace.updatedAt} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore
        onClick={() => void list.fetchNextPage()}
        loading={list.isFetchingNextPage}
        exhausted={!list.hasNextPage}
      />
      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
