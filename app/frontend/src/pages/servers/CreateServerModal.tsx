import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { serversApi } from '../../api/servers';
import { serverKeys } from '../../api/keys';
import type { ServerAuthType, ServerTestResult } from '../../api/types';
import { apiErrorCode, codeText, errorText } from '../../errors/errorText';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { CopyButton } from '../../ui/CopyButton';
import { Modal } from '../../ui/Modal';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { TextField } from '../../ui/TextField';
import { Textarea } from '../../ui/Textarea';

/** Зеркало бэкенд-валидации (CreateServerDto): 400-ответ — fallback, не норма. */
const NAME_RE = /^[\p{L}\p{N} _#-]{1,64}$/u;
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const KEY_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;

const AUTH_OPTIONS: { value: ServerAuthType; label: string }[] = [
  { value: 'PASSWORD', label: 'Пароль' },
  { value: 'KEY', label: 'Приватный ключ' },
];

interface FieldErrors {
  name?: string;
  host?: string;
  port?: string;
  sshUsername?: string;
  secret?: string;
}

/** Итог «Тестового соединения» в модалке. */
type DraftFeedback =
  | { kind: 'tofu'; fingerprint: string }
  | { kind: 'ok'; result: ServerTestResult }
  | { kind: 'fail'; text: string; code: string | null };

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function CreateServerModal({ open, onClose, workspaceId }: CreateServerModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [sshUsername, setSshUsername] = useState('');
  const [authType, setAuthType] = useState<ServerAuthType>('PASSWORD');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFeedback | null>(null);
  /** Отпечаток, подтверждённый в мастере: уходит в create и пинится сразу. */
  const [trustedFingerprint, setTrustedFingerprint] = useState<string | null>(null);

  function connectionInput(): {
    host: string;
    port: number;
    sshUsername: string;
    authType: ServerAuthType;
    sshPassword?: string;
    sshPrivateKey?: string;
  } {
    return {
      host: host.trim().toLowerCase(),
      port: Number.parseInt(port, 10),
      sshUsername: sshUsername.trim().toLowerCase(),
      authType,
      ...(authType === 'PASSWORD' ? { sshPassword } : { sshPrivateKey }),
    };
  }

  const create = useMutation({
    mutationFn: () =>
      serversApi.create(workspaceId, {
        name: name.trim(),
        ...connectionInput(),
        ...(trustedFingerprint
          ? { hostKeyFingerprint: trustedFingerprint }
          : {}),
      }),
    onSuccess: () => {
      // Инвалидация всего домена: новая строка должна появиться и в поиске.
      void queryClient.invalidateQueries({ queryKey: serverKeys.all });
      reset();
      onClose();
    },
    onError: (err) => setSubmitError(errorText(err, 'serverCreate')),
  });

  const probe = useMutation({
    mutationFn: (trustHostKey?: string) =>
      serversApi.testConnection(workspaceId, {
        ...connectionInput(),
        ...(trustHostKey ? { trustHostKey } : {}),
      }),
    onSuccess: (result) => {
      if (result.trustRequired && result.hostKeyFingerprint) {
        setDraft({ kind: 'tofu', fingerprint: result.hostKeyFingerprint });
        return;
      }
      if (!result.reachable) {
        setDraft({
          kind: 'fail',
          text: result.errorCode
            ? (codeText(result.errorCode) ?? 'Соединение не удалось.')
            : 'Соединение не удалось.',
          code: result.errorCode,
        });
        return;
      }
      setTrustedFingerprint(result.hostKeyFingerprint);
      setDraft({ kind: 'ok', result });
    },
    onError: (err) =>
      setDraft({
        kind: 'fail',
        text: errorText(err, 'serverTest'),
        code: apiErrorCode(err),
      }),
  });

  /** Правка полей соединения обесценивает прошлый результат и пин. */
  function resetProbe(): void {
    setDraft(null);
    setTrustedFingerprint(null);
  }

  function reset(): void {
    setName('');
    setHost('');
    setPort('22');
    setSshUsername('');
    setAuthType('PASSWORD');
    setSshPassword('');
    setSshPrivateKey('');
    setPasswordVisible(false);
    setErrors({});
    setSubmitError(null);
    resetProbe();
  }

  /** Поля соединения — без имени: тест не обязан знать, как сервер назовут. */
  function validateConnection(): FieldErrors {
    const next: FieldErrors = {};
    if (!HOST_RE.test(host.trim().toLowerCase())) {
      next.host = 'Только строчные буквы, цифры, точка и дефис.';
    }
    const portNumber = /^\d+$/.test(port.trim()) ? Number.parseInt(port.trim(), 10) : NaN;
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      next.port = 'Целое число от 1 до 65535.';
    }
    if (!USER_RE.test(sshUsername.trim().toLowerCase())) {
      next.sshUsername = 'POSIX-имя: строчные буквы, цифры, _ - (до 32 символов).';
    }
    if (authType === 'PASSWORD') {
      if (sshPassword.length < 8 || sshPassword.length > 512) {
        next.secret = 'Пароль от 8 до 512 символов.';
      }
    } else if (sshPrivateKey.includes('ENCRYPTED')) {
      next.secret = 'Зашифрованные ключи не поддерживаются.';
    } else if (
      !KEY_RE.test(sshPrivateKey) ||
      sshPrivateKey.length < 32 ||
      sshPrivateKey.length > 16384
    ) {
      next.secret = 'Нужен приватный ключ в формате OpenSSH или PEM (PKCS#1).';
    }
    return next;
  }

  function validate(): FieldErrors {
    const next = validateConnection();
    if (!NAME_RE.test(name.trim())) {
      next.name = 'Только буквы, цифры, пробел и - _ # (1–64 символа).';
    }
    return next;
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitError(null);
    create.mutate();
  }

  function runProbe(): void {
    const found = validateConnection();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitError(null);
    probe.mutate(undefined);
  }

  function okText(result: ServerTestResult): string {
    if (!result.dockerVersion) {
      return `Хост доступен, но Docker недоступен (${
        codeText(result.dockerErrorCode) ?? 'нет ответа'
      }).`;
    }
    return result.osName
      ? `Соединение установлено: Docker ${result.dockerVersion}, ${result.osName}.`
      : `Соединение установлено: Docker ${result.dockerVersion}.`;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый сервер"
      wide
      dismissable={false}
    >
      <form className="sv-form" onSubmit={submit} noValidate>
        {submitError && <Callout tone="danger">{submitError}</Callout>}
        <TextField
          label="Имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? null}
          hint="Отображаемое имя сервера в панели"
          autoFocus
          required
        />
        <div className="sv-form-row">
          <TextField
            label="Хост"
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
              resetProbe();
            }}
            error={errors.host ?? null}
            placeholder="10.0.0.5 или node.example.com"
            required
          />
          <TextField
            className="sv-port"
            label="Порт"
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              resetProbe();
            }}
            error={errors.port ?? null}
            inputMode="numeric"
            required
          />
        </div>
        <TextField
          label="Пользователь SSH"
          value={sshUsername}
          onChange={(event) => {
            setSshUsername(event.target.value);
            resetProbe();
          }}
          error={errors.sshUsername ?? null}
          placeholder="deploy"
          required
        />
        <SegmentedControl
          legend="Аутентификация"
          value={authType}
          options={AUTH_OPTIONS}
          onChange={(value) => {
            setAuthType(value);
            resetProbe();
          }}
        />
        {authType === 'PASSWORD' ? (
          <TextField
            label="Пароль SSH"
            type={passwordVisible ? 'text' : 'password'}
            value={sshPassword}
            onChange={(event) => {
              setSshPassword(event.target.value);
              resetProbe();
            }}
            error={errors.secret ?? null}
            autoComplete="new-password"
            required
            trailing={
              <button
                type="button"
                className="field-eye"
                aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                aria-pressed={passwordVisible}
                title={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                onClick={() => setPasswordVisible((v) => !v)}
              >
                {passwordVisible ? (
                  <EyeOff size={18} aria-hidden />
                ) : (
                  <Eye size={18} aria-hidden />
                )}
              </button>
            }
          />
        ) : (
          <Textarea
            label="Приватный ключ"
            value={sshPrivateKey}
            onChange={(event) => {
              setSshPrivateKey(event.target.value);
              resetProbe();
            }}
            error={errors.secret ?? null}
            hint="OpenSSH или PEM без пароля; хранится в зашифрованном виде"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            mono
            rows={6}
            required
          />
        )}
        {draft?.kind === 'tofu' && (
          <div className="sv-probe">
            <Callout tone="warn">
              Ключ хоста ещё не подтверждён — сверьте отпечаток с сервером:
              <div className="sv-fp">
                <code className="mono">{draft.fingerprint}</code>
                <CopyButton value={draft.fingerprint} />
              </div>
            </Callout>
            <div className="sv-probe-actions">
              <Button
                onClick={() => probe.mutate(draft.fingerprint)}
                loading={probe.isPending}
              >
                Доверять отпечатку
              </Button>
            </div>
          </div>
        )}
        {draft?.kind === 'ok' && (
          <Callout tone={draft.result.dockerVersion ? 'ok' : 'warn'}>
            {okText(draft.result)}
          </Callout>
        )}
        {draft?.kind === 'fail' && (
          <Callout tone="danger">
            {draft.text}
            {draft.code && <> <span className="mono">({draft.code})</span></>}
          </Callout>
        )}
        <div className="sv-form-actions">
          <Button
            onClick={runProbe}
            loading={probe.isPending}
            disabled={probe.isPending || create.isPending}
          >
            Тестовое соединение
          </Button>
          <div className="sv-form-actions-main">
            <Button onClick={onClose}>Отмена</Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={probe.isPending}
            >
              Сохранить
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
