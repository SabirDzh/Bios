import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
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
import { Modal } from '../../ui/Modal';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { Table } from '../../ui/Table';
import { TextField } from '../../ui/TextField';
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
  const navigate = useNavigate();
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
      <Table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Роль</th>
            <th>Создано</th>
          </tr>
        </thead>
        <tbody>
          {list.workspaces.map((workspace) => (
            <tr
              key={workspace.id}
              className="ws-row"
              onClick={() => navigate(`/w/${workspace.id}`)}
            >
              <td className="ellipsis" title={workspace.name}>
                {workspace.name}
              </td>
              <td>
                <RoleChip role={workspace.role} />
              </td>
              <td className="ws-date">{formatDate(workspace.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {list.hasNextPage && (
        <div className="ws-more">
          <Button
            onClick={() => void list.fetchNextPage()}
            loading={list.isFetchingNextPage}
          >
            Показать ещё
          </Button>
        </div>
      )}
      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
