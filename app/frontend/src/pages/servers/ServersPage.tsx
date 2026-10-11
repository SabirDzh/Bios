import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, PlugZap, RefreshCw, Search, Server } from 'lucide-react';
import { serversApi } from '../../api/servers';
import { workspacesApi } from '../../api/workspaces';
import { serverKeys, workspaceKeys } from '../../api/keys';
import { ApiError } from '../../api/client';
import type { ServerAuthType, ServerTestResult } from '../../api/types';
import { apiErrorCode, codeText, errorText, isUnauthorized } from '../../errors/errorText';
import { plural } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { agentStatus, serverStatus } from '../../lib/statusMeta';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { CopyButton } from '../../ui/CopyButton';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { FullPage } from '../../ui/FullPage';
import { IconButton } from '../../ui/IconButton';
import { LoadMore } from '../../ui/LoadMore';
import { OsIcon } from '../../ui/OsIcon';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { Spinner } from '../../ui/Spinner';
import { StatusBadge } from '../../ui/StatusBadge';
import { TextField } from '../../ui/TextField';
import { Timestamp } from '../../ui/Timestamp';
import { Toolbar } from '../../ui/Toolbar';
import { CreateServerModal } from './CreateServerModal';
import { useServerList, useServerSearch } from './servers.queries';
import './servers.css';

type TestOutcome =
  | { kind: 'ok' | 'warn'; serverId: string; name: string; result: ServerTestResult }
  | { kind: 'fail'; serverId: string; name: string; text: string; code: string | null };

interface TofuState {
  serverId: string;
  name: string;
  host: string;
  fingerprint: string;
}

const AUTH_TEXT: Record<ServerAuthType, string> = {
  PASSWORD: 'пароль',
  KEY: 'приватный ключ',
};

function OutcomeCallout({ outcome }: { outcome: TestOutcome }) {
  if (outcome.kind === 'fail') {
    return (
      <Callout tone="danger">
        {outcome.name}: {outcome.text}{' '}
        {outcome.code && <span className="mono">({outcome.code})</span>}
      </Callout>
    );
  }
  const { result } = outcome;
  if (outcome.kind === 'warn') {
    return (
      <Callout tone="warn">
        {outcome.name}: SSH работает, но{' '}
        {result.dockerErrorCode
          ? codeText(result.dockerErrorCode) ?? 'Docker недоступен'
          : 'панель не распознала версию Docker'}
        .{' '}
        {result.dockerErrorCode && (
          <span className="mono">({result.dockerErrorCode})</span>
        )}
      </Callout>
    );
  }
  return (
    <Callout tone="ok">
      {outcome.name}: соединение установлено · Docker {result.dockerVersion} ·{' '}
      <span className="sv-num">{result.latencyMs} мс</span>
    </Callout>
  );
}

export function ServersPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();

  // detail уже в кэше: WorkspaceLayout грузит его до рендера Outlet —
  // отсюда имя пространства для крошек и роль для прав.
  const detail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => workspacesApi.get(workspaceId),
    enabled: workspaceId !== '',
  });
  const list = useServerList(workspaceId);

  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [tofu, setTofu] = useState<TofuState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(0);

  // Поиск серверный (Meilisearch, дебаунс 300 мс): ищет по всем серверам
  // пространства, а не только по загруженным страницам; устаревшие ответы
  // отменяет useQuery сменой ключа (signal уходит в API).
  const searchQuery = useDebouncedValue(query.trim(), 300);
  const searching = searchQuery !== '';
  const search = useServerSearch(workspaceId, searchQuery);

  const cooling = cooldownUntil > clock;

  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  // «Проверить» может нажать строку из выдачи поиска — загруженных страниц мало.
  const findServer = (id: string) =>
    list.servers.find((s) => s.id === id) ??
    search.data?.items.find((s) => s.id === id);

  // Шторка живёт, пока выбран id; сервер пропал из выдачи — шторка закрылась.
  const detailServer = detailId === null ? undefined : findServer(detailId);

  const test = useMutation({
    mutationFn: (vars: { serverId: string; trustHostKey?: string }) =>
      serversApi.test(
        workspaceId,
        vars.serverId,
        vars.trustHostKey ? { trustHostKey: vars.trustHostKey } : undefined,
      ),
    onMutate: () => setOutcome(null),
    onSuccess: (result, vars) => {
      const server = findServer(vars.serverId);
      const name = server?.name ?? 'Сервер';
      // Весь домен: проверка меняет статус и в списке, и в выдаче поиска.
      void queryClient.invalidateQueries({ queryKey: serverKeys.all });
      if (result.trustRequired && result.hostKeyFingerprint) {
        setTofu({
          serverId: vars.serverId,
          name,
          host: server ? `${server.host}:${server.port}` : '',
          fingerprint: result.hostKeyFingerprint,
        });
        return;
      }
      setTofu(null);
      if (!result.reachable) {
        setOutcome({
          kind: 'fail',
          serverId: vars.serverId,
          name,
          text: result.errorCode
            ? codeText(result.errorCode) ?? 'Соединение не удалось.'
            : 'Соединение не удалось.',
          code: result.errorCode,
        });
        return;
      }
      setOutcome(
        result.dockerVersion
          ? { kind: 'ok', serverId: vars.serverId, name, result }
          : { kind: 'warn', serverId: vars.serverId, name, result },
      );
    },
    onError: (err, vars) => {
      setTofu(null);
      if (err instanceof ApiError && err.status === 429) {
        setClock(Date.now());
        setCooldownUntil(Date.now() + 60_000);
        return;
      }
      const server = findServer(vars.serverId);
      setOutcome({
        kind: 'fail',
        serverId: vars.serverId,
        name: server?.name ?? 'Сервер',
        text: errorText(err, 'serverTest'),
        code: apiErrorCode(err),
      });
    },
  });

  const isOwner = detail.data?.role === 'OWNER';
  const busyDetail =
    detailServer !== undefined &&
    test.isPending &&
    test.variables?.serverId === detailServer.id;

  const addButton = isOwner ? (
    <Button
      variant="primary"
      icon={<Plus size={14} aria-hidden />}
      onClick={() => setCreateOpen(true)}
    >
      Добавить сервер
    </Button>
  ) : null;

  if (list.isPending) {
    return (
      <div className="page">
        <PageHeader title="Серверы" actions={addButton} />
        <div className="sv-skeleton">
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
        <PageHeader title="Серверы" actions={addButton} />
        <div className="sv-skeleton">
          <ErrorState
            description={errorText(list.error)}
            onRetry={() => void list.refetch()}
          />
        </div>
      </div>
    );
  }

  if (list.servers.length === 0) {
    return (
      <div className="page">
        <PageHeader title="Серверы" actions={addButton} />
        <div className="sv-empty">
          <EmptyState
            icon={<Server size={22} aria-hidden />}
            title="Серверов пока нет"
            description={
              isOwner
                ? 'Добавьте первый сервер по SSH — панель проверит подключение и покажет состояние Docker.'
                : 'Первое подключение создаёт владелец пространства.'
            }
            action={
              isOwner ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Добавить сервер
                </Button>
              ) : undefined
            }
          />
        </div>
        <CreateServerModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          workspaceId={workspaceId}
        />
      </div>
    );
  }

  // 401 после refresh — сессия мертва: слой сессии уведёт на вход.
  if (searching && search.isError && isUnauthorized(search.error)) {
    return (
      <FullPage>
        <Spinner size={22} />
      </FullPage>
    );
  }

  const refetching = list.isFetching && !list.isFetchingNextPage && !list.isPending;
  const visibleServers = searching ? (search.data?.items ?? []) : list.servers;
  const countText = searching
    ? search.isError
      ? 'Поиск недоступен'
      : search.data === undefined
        ? 'Поиск…'
        : search.data.total > search.data.items.length
          ? `Показаны первые ${search.data.items.length} из ${search.data.total}`
          : `${search.data.total} ${plural(search.data.total, 'сервер', 'сервера', 'серверов')}`
    : list.hasNextPage
      ? `Загружено ${list.servers.length}`
      : `${list.servers.length} ${plural(list.servers.length, 'сервер', 'сервера', 'серверов')}`;
  const secsLeft = cooling
    ? Math.max(1, Math.ceil((cooldownUntil - clock) / 1000))
    : 0;

  return (
    <div className="page">
      <PageHeader title="Серверы" actions={addButton} />
      <div className="sv-search">
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени или хосту"
          aria-label="Поиск серверов"
          maxLength={64}
          leading={<Search size={15} aria-hidden className="field-leading" />}
        />
      </div>
      <Toolbar
        busy={searching ? search.isFetching : refetching}
        actions={
          <IconButton
            label="Обновить"
            icon={<RefreshCw size={14} aria-hidden />}
            onClick={() => void (searching ? search.refetch() : list.refetch())}
            disabled={searching ? search.isFetching : list.isFetching}
          />
        }
      >
        <span className="sv-count" aria-live={searching ? 'polite' : undefined}>
          {countText}
        </span>
      </Toolbar>
      <div className="sv-feedback">
        {cooling ? (
          <Callout tone="warn">
            Слишком много SSH-операций — панель разрешает 6 в минуту. Повторить
            можно через {secsLeft} с.
          </Callout>
        ) : (
          // Результат «своего» сервера показывает открытая шторка — не дублируем.
          outcome &&
          !(detailServer && outcome.serverId === detailServer.id) && (
            <OutcomeCallout outcome={outcome} />
          )
        )}
      </div>
      {searching && search.isError ? (
        <div className="sv-empty">
          <ErrorState
            description={errorText(search.error, 'serverSearch')}
            onRetry={() => void search.refetch()}
          />
        </div>
      ) : searching && search.data === undefined ? (
        <div className="sv-skeleton">
          <Skeleton lines={3} />
        </div>
      ) : visibleServers.length === 0 ? (
        <div className="sv-empty">
          <EmptyState
            icon={<Search size={22} aria-hidden />}
            title="Ничего не найдено"
            description={`По запросу «${searchQuery}» в этом пространстве серверов нет.`}
          />
        </div>
      ) : (
      <ul className="sv-grid stagger" role="list">
        {visibleServers.map((server, idx) => {
          const busyCard = test.isPending && test.variables?.serverId === server.id;
          return (
            <li
              key={server.id}
              className="sv-card"
              style={{ '--i': idx } as CSSProperties}
            >
              <button
                type="button"
                className="sv-card-open"
                aria-label={`Открыть детали: ${server.name}`}
                onClick={() => setDetailId(server.id)}
              />
              <div className="sv-card-head">
                <OsIcon osName={server.osName} />
                <div className="sv-card-id">
                  <div className="sv-name" title={server.name}>
                    {server.name}
                  </div>
                  <div className="sv-user" title={`SSH: ${server.sshUsername}`}>
                    {server.sshUsername}
                  </div>
                </div>
                <IconButton
                  label="Проверить"
                  size="sm"
                  className={busyCard ? 'is-busy' : undefined}
                  disabled={test.isPending || cooling}
                  icon={
                    busyCard ? (
                      <Loader2 size={14} className="spin" aria-hidden />
                    ) : (
                      <PlugZap size={14} aria-hidden />
                    )
                  }
                  onClick={() => test.mutate({ serverId: server.id })}
                />
              </div>
            </li>
          );
        })}
      </ul>
      )}
      {!searching && (
        <LoadMore
          onClick={() => void list.fetchNextPage()}
          loading={list.isFetchingNextPage}
          exhausted={!list.hasNextPage}
        />
      )}
      <ConfirmDialog
        open={tofu !== null}
        onClose={() => setTofu(null)}
        title="Доверять ключу хоста?"
        tone="primary"
        confirmLabel="Доверять"
        loading={test.isPending}
        onConfirm={() => {
          if (!tofu) return;
          test.mutate({ serverId: tofu.serverId, trustHostKey: tofu.fingerprint });
        }}
        description={
          tofu && (
            <>
              <p>
                {tofu.name} ({tofu.host}) предъявил ключ хоста. Сверьте отпечаток с
                хостом — панель запомнит его и прервёт соединение при подмене.
              </p>
              <div className="sv-fp">
                <code className="mono">{tofu.fingerprint}</code>
                <CopyButton value={tofu.fingerprint} />
              </div>
            </>
          )
        }
      />
      {detailServer && (
        <Drawer
          open
          onClose={() => setDetailId(null)}
          ariaLabel={`Детали сервера ${detailServer.name}`}
          title={
            <>
              <OsIcon osName={detailServer.osName} />
              <span className="sv-drawer-name" title={detailServer.name}>
                {detailServer.name}
              </span>
            </>
          }
          footer={
            <Button
              variant="primary"
              icon={<PlugZap size={14} aria-hidden />}
              loading={busyDetail}
              disabled={test.isPending || cooling}
              onClick={() => test.mutate({ serverId: detailServer.id })}
            >
              Подключиться
            </Button>
          }
        >
          {outcome && outcome.serverId === detailServer.id && (
            <div className="sv-drawer-feedback">
              <OutcomeCallout outcome={outcome} />
            </div>
          )}
          <dl className="sv-dl">
            <dt>ОС</dt>
            <dd>{detailServer.osName ?? 'не определена'}</dd>
            <dt>Хост</dt>
            <dd className="mono">
              {detailServer.host}:{detailServer.port}
            </dd>
            <dt>Пользователь SSH</dt>
            <dd>{detailServer.sshUsername}</dd>
            <dt>Аутентификация</dt>
            <dd>{AUTH_TEXT[detailServer.authType]}</dd>
            <dt>Docker</dt>
            <dd className="mono">{detailServer.dockerVersion ?? '—'}</dd>
            {detailServer.hostKeyFingerprint && (
              <>
                <dt>Отпечаток хоста</dt>
                <dd className="sv-dl-fp">
                  <code className="mono">{detailServer.hostKeyFingerprint}</code>
                  <CopyButton value={detailServer.hostKeyFingerprint} />
                </dd>
              </>
            )}
          </dl>
          <h3 className="sv-drawer-h">Состояние</h3>
          <dl className="sv-dl">
            <dt>Статус</dt>
            <dd>
              <StatusBadge meta={serverStatus(detailServer.status)} />
            </dd>
            <dt>Последняя проверка</dt>
            <dd>
              <Timestamp iso={detailServer.lastCheckedAt} />
            </dd>
            <dt>Агент</dt>
            <dd>
              <span className="sv-agent">
                <StatusBadge
                  meta={agentStatus(detailServer.lastAgentStatus ?? 'NOT_INSTALLED')}
                />
                {detailServer.agentVersion && (
                  <span className="sv-ver">{detailServer.agentVersion}</span>
                )}
              </span>
            </dd>
            {detailServer.agentInstalledAt && (
              <>
                <dt>Агент установлен</dt>
                <dd>
                  <Timestamp iso={detailServer.agentInstalledAt} absolute />
                </dd>
              </>
            )}
            {detailServer.lastAgentErrorCode && (
              <>
                <dt>Ошибка агента</dt>
                <dd className="mono">{detailServer.lastAgentErrorCode}</dd>
              </>
            )}
          </dl>
        </Drawer>
      )}
      <CreateServerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
      />
    </div>
  );
}
