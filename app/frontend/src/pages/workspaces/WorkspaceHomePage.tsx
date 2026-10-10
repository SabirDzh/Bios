import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { workspaceKeys } from '../../api/keys';
import type { Invitation } from '../../api/types';
import { errorText, isUnauthorized } from '../../errors/errorText';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { CopyButton } from '../../ui/CopyButton';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { TextField } from '../../ui/TextField';
import './workspace-home.css';

function InviteResult({ invitation }: { invitation: Invitation }) {
  const link = `bios://join/${invitation.workspaceId}/${invitation.token}`;
  return (
    <div className="invite-result" role="status">
      <div className="invite-result-title">Приглашение создано</div>
      <div className="invite-field">
        <span className="invite-label">Токен</span>
        <code className="mono invite-value">{invitation.token}</code>
        <CopyButton value={invitation.token} />
      </div>
      <div className="invite-field">
        <span className="invite-label">Ссылка для передачи</span>
        <code className="mono invite-value">{link}</code>
        <CopyButton value={link} />
      </div>
      <p className="invite-hint">
        Токен показывается один раз — передайте его приглашённому вместе с
        идентификатором пространства. Действует до{' '}
        {formatDateTime(invitation.expiresAt)}. Повторное приглашение на тот же
        адрес отменяет предыдущее.
      </p>
    </div>
  );
}

function InviteSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Invitation | null>(null);

  const invite = useMutation({
    mutationFn: (value: string) => workspacesApi.invite(workspaceId, { email: value }),
    onSuccess: (invitation) => {
      setResult(invitation);
      setError(null);
      setEmail('');
    },
    onError: (err) => setError(errorText(err, 'invite')),
  });

  if (!isOwner) {
    return (
      <p className="muted-note">
        Приглашать участников может владелец пространства.
      </p>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError('Укажите корректный email.');
      return;
    }
    invite.mutate(value);
  }

  return (
    <div className="invite-section">
      <form className="invite-form" onSubmit={submit} noValidate>
        <TextField
          label="Email приглашённого"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="user@example.com"
          error={error}
          required
        />
        <Button type="submit" variant="primary" loading={invite.isPending}>
          Пригласить
        </Button>
      </form>
      {result && <InviteResult invitation={result} />}
    </div>
  );
}

export function WorkspaceHomePage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const detail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });

  if (detail.isPending) {
    return (
      <div className="page">
        <Skeleton lines={3} />
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
    return (
      <div className="page">
        <ErrorState
          description={errorText(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }

  const workspace = detail.data;

  return (
    <div className="page">
      <div className="wh-header">
        <h1>{workspace.name}</h1>
        {workspace.role === 'OWNER' ? (
          <Chip tone="accent">владелец</Chip>
        ) : (
          <Chip tone="neutral">участник</Chip>
        )}
      </div>

      <section className="wh-section">
        <h2>Участники</h2>
        <InviteSection workspaceId={workspace.id} isOwner={workspace.role === 'OWNER'} />
        <p className="muted-note">
          Приглашение принимается на странице{' '}
          <Link to="/join">ввода токена</Link>.
        </p>
      </section>
    </div>
  );
}
