import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../../api/projects';
import { projectKeys } from '../../api/keys';
import { errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Modal } from '../../ui/Modal';
import { TextField } from '../../ui/TextField';
import { validateDisplayName, validateRepoUrl } from './validate';

interface FieldErrors {
  name?: string;
  repoUrl?: string;
}

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function CreateProjectModal({ open, onClose, workspaceId }: CreateProjectModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      projectsApi.create(workspaceId, { name: name.trim(), repoUrl: repoUrl.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list(workspaceId) });
      reset();
      onClose();
    },
    onError: (err) => setSubmitError(errorText(err, 'projectCreate')),
  });

  function reset(): void {
    setName('');
    setRepoUrl('');
    setErrors({});
    setSubmitError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const found: FieldErrors = {};
    const nameError = validateDisplayName(name);
    if (nameError) found.name = nameError;
    const repoError = validateRepoUrl(repoUrl);
    if (repoError) found.repoUrl = repoError;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitError(null);
    create.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый проект">
      <form className="pj-form" onSubmit={submit} noValidate>
        {submitError && <Callout tone="danger">{submitError}</Callout>}
        <TextField
          label="Имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? null}
          hint="Отображаемое имя проекта в панели"
          autoFocus
          required
        />
        <TextField
          label="Репозиторий"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          error={errors.repoUrl ?? null}
          placeholder="https://github.com/acme/app"
          hint="Публичный HTTPS. Приватные репозитории и адреса с учётными данными не поддерживаются."
          required
        />
        <div className="pj-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Добавить проект
          </Button>
        </div>
      </form>
    </Modal>
  );
}
