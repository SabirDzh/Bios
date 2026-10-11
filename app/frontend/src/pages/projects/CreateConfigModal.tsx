import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../../api/projects';
import { projectKeys } from '../../api/keys';
import { errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Modal } from '../../ui/Modal';
import { Select } from '../../ui/Select';
import { TextField } from '../../ui/TextField';
import { Textarea } from '../../ui/Textarea';
import { useServerOptions } from './projects.queries';
import {
  validateContainerName,
  validateDockerfile,
  validateDisplayName,
  validateGitRef,
  validatePorts,
} from './validate';

interface FieldErrors {
  name?: string;
  serverId?: string;
  ref?: string;
  dockerfile?: string;
  containerName?: string;
  ports?: string;
}

interface CreateConfigModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  projectId: string;
}

/**
 * Конфиг деплоя: что и как собирать. Метод в этом срезе один — GIT_PULL,
 * показан недоступным Select-ом, чтобы список исполняемых методов не
 * приходилось воображать.
 */
export function CreateConfigModal({
  open,
  onClose,
  workspaceId,
  projectId,
}: CreateConfigModalProps) {
  const queryClient = useQueryClient();
  const servers = useServerOptions(workspaceId);

  const [name, setName] = useState('');
  const [serverId, setServerId] = useState('');
  const [ref, setRef] = useState('main');
  const [dockerfile, setDockerfile] = useState('Dockerfile');
  const [containerName, setContainerName] = useState('');
  const [portsRaw, setPortsRaw] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      projectsApi.createConfig(workspaceId, projectId, {
        name: name.trim(),
        method: 'GIT_PULL',
        ref: ref.trim(),
        ...(dockerfile.trim() !== '' ? { dockerfile: dockerfile.trim() } : {}),
        containerName: containerName.trim(),
        ports: validatePorts(portsRaw).ports,
        serverId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.configs(workspaceId, projectId),
      });
      reset();
      onClose();
    },
    onError: (err) => setSubmitError(errorText(err, 'deployConfig')),
  });

  function reset(): void {
    setName('');
    setServerId('');
    setRef('main');
    setDockerfile('Dockerfile');
    setContainerName('');
    setPortsRaw('');
    setErrors({});
    setSubmitError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const found: FieldErrors = {};

    const nameError = validateDisplayName(name);
    if (nameError) found.name = nameError;
    if (serverId === '') {
      found.serverId = 'Выберите сервер для исполнения деплоя.';
    }
    const refError = validateGitRef(ref);
    if (refError) found.ref = refError;
    // Пусто — не ошибка: бэкенд подставит Dockerfile в корне репозитория.
    if (dockerfile.trim() !== '') {
      const dockerfileError = validateDockerfile(dockerfile);
      if (dockerfileError) found.dockerfile = dockerfileError;
    }
    const containerError = validateContainerName(containerName);
    if (containerError) found.containerName = containerError;
    const ports = validatePorts(portsRaw);
    if (ports.error) found.ports = ports.error;

    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitError(null);
    create.mutate();
  }

  const serverItems = servers.data?.items ?? [];
  const noServers =
    !servers.isPending && !servers.isError && serverItems.length === 0;

  return (
    <Modal open={open} onClose={onClose} title="Новый конфиг деплоя">
      <form className="pj-form" onSubmit={submit} noValidate>
        {submitError && <Callout tone="danger">{submitError}</Callout>}
        <TextField
          label="Имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? null}
          hint="Имя конфига в панели, например web-prod"
          autoFocus
          required
        />
        <Select
          label="Сервер"
          value={serverId}
          onChange={(event) => setServerId(event.target.value)}
          error={
            errors.serverId ??
            (noServers ? 'Сначала добавьте хотя бы один сервер.' : null)
          }
          hint={
            servers.isError
              ? 'Не удалось загрузить список серверов.'
              : servers.isPending
                ? 'Загрузка серверов…'
                : undefined
          }
          disabled={servers.isPending}
          required
        >
          <option value="" disabled>
            — выберите сервер —
          </option>
          {serverItems.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name} ({server.host})
            </option>
          ))}
        </Select>
        <Select
          label="Метод"
          value="GIT_PULL"
          hint="Пока поддерживается один метод: git clone исходников и docker build"
          disabled
        >
          <option value="GIT_PULL">Сборка из Git (GIT_PULL)</option>
        </Select>
        <TextField
          label="Ветка или тег"
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          error={errors.ref ?? null}
          placeholder="main"
          required
        />
        <TextField
          label="Dockerfile"
          value={dockerfile}
          onChange={(event) => setDockerfile(event.target.value)}
          error={errors.dockerfile ?? null}
          hint="Путь от корня репозитория; пусто — Dockerfile в корне"
        />
        <TextField
          label="Имя контейнера"
          value={containerName}
          onChange={(event) => setContainerName(event.target.value)}
          error={errors.containerName ?? null}
          placeholder="web-prod-1"
          hint="Должно быть свободно на выбранном сервере"
          required
        />
        <Textarea
          label="Порты"
          value={portsRaw}
          onChange={(event) => setPortsRaw(event.target.value)}
          error={errors.ports ?? null}
          hint="Один маппинг на строку: 8080:80 или 8080:80/tcp"
          placeholder={'8080:80'}
          mono
          rows={3}
        />
        <div className="pj-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={noServers}
          >
            Добавить конфиг
          </Button>
        </div>
      </form>
    </Modal>
  );
}
