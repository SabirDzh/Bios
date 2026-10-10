import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { setLastWorkspaceId } from '../../api/lastWorkspace';
import { errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import './join.css';

interface AcceptValues {
  workspaceId: string;
  token: string;
}

export function JoinPage() {
  const params = useParams<{ workspaceId?: string; token?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [workspaceId, setWorkspaceId] = useState(params.workspaceId ?? '');
  const [token, setToken] = useState(params.token ?? '');
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (values: AcceptValues) =>
      workspacesApi.accept(values.workspaceId, { token: values.token }),
    onSuccess: (membership) => {
      setLastWorkspaceId(membership.workspaceId);
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      navigate(`/w/${membership.workspaceId}`, { replace: true });
    },
    onError: (err) => setError(errorText(err, 'accept')),
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const ws = workspaceId.trim();
    const tk = token.trim();
    if (!ws || !tk) {
      setError('Заполните идентификатор пространства и токен.');
      return;
    }
    setError(null);
    accept.mutate({ workspaceId: ws, token: tk });
  }

  return (
    <div className="page">
      <h1>Принять приглашение</h1>
      <p className="muted-note">
        Вставьте идентификатор пространства и токен из приглашения.
      </p>
      <form className="join-form" onSubmit={submit} noValidate>
        {error && (
          <div className="ws-form-error" role="alert">
            {error}
          </div>
        )}
        <TextField
          label="Идентификатор пространства"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          autoComplete="off"
          required
        />
        <TextField
          label="Токен приглашения"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          required
        />
        <Button
          type="submit"
          variant="primary"
          className="auth-submit"
          loading={accept.isPending}
        >
          Принять приглашение
        </Button>
      </form>
    </div>
  );
}
