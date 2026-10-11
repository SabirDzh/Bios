import { useState } from 'react';
import { PlugZap, Plus, RefreshCw, Server } from 'lucide-react';
import { agentStatus, containerState, deploymentStatus, serverStatus } from '../lib/statusMeta';
import '../pages/servers/servers.css';
import { Breadcrumbs } from './Breadcrumbs';
import { Button } from './Button';
import { Callout } from './Callout';
import { Checkbox } from './Checkbox';
import { Chip } from './Chip';
import { ConfirmDialog } from './ConfirmDialog';
import { CopyButton } from './CopyButton';
import { Drawer } from './Drawer';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { IconButton } from './IconButton';
import { LoadMore } from './LoadMore';
import { LogPanel } from './LogPanel';
import { Modal } from './Modal';
import { OsIcon } from './OsIcon';
import { PageHeader } from './PageHeader';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { StatusBadge } from './StatusBadge';
import { StepProgress } from './StepProgress';
import { Table } from './Table';
import { Textarea } from './Textarea';
import { TextField } from './TextField';
import { Timestamp } from './Timestamp';
import { Toolbar } from './Toolbar';
import './KitPage.css';

const FIVE_MIN_AGO_ISO = new Date(Date.now() - 5 * 60_000).toISOString();

/**
 * Витрина примитивов — только dev-сборка (маршрут /kit).
 * Данные здесь синтетические и подписаны как витрина; в приложение
 * из этого файла не попадает ни одно значение.
 */
export function KitPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPrimaryOpen, setConfirmPrimaryOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kitAuth, setKitAuth] = useState<'PASSWORD' | 'KEY'>('PASSWORD');
  const [kitPaused, setKitPaused] = useState(false);

  return (
    <div className="page kit">
      <h1>Витрина примитивов</h1>
      <p className="kit-note">
        Dev-страница. Синтетические данные для проверки токенов и состояний — не
        данные инфраструктуры.
      </p>

      <section className="kit-section">
        <h2>Button</h2>
        <div className="kit-row">
          <Button variant="primary">Основная</Button>
          <Button>Обычная</Button>
          <Button variant="ghost">Прозрачная</Button>
          <Button variant="danger">Опасная</Button>
          <Button variant="danger-solid">Опасная сплошная</Button>
          <Button loading>Загрузка</Button>
          <Button disabled>Недоступна</Button>
          <Button size="sm" variant="primary">
            Малая
          </Button>
        </div>
      </section>

      <section className="kit-section">
        <h2>IconButton / CopyButton</h2>
        <div className="kit-row">
          <IconButton label="Обновить" icon={<RefreshCw size={14} aria-hidden />} />
          <IconButton
            label="Обновить"
            icon={<RefreshCw size={14} aria-hidden />}
            variant="default"
          />
          <IconButton
            label="Обновить"
            icon={<RefreshCw size={14} aria-hidden />}
            size="sm"
          />
          <CopyButton value="bios://join/demo/demo-token" label="Скопировать пример" />
        </div>
      </section>

      <section className="kit-section">
        <h2>TextField / Select / Checkbox</h2>
        <div className="kit-row kit-row-top">
          <TextField label="Имя" placeholder="prod-1" />
          <TextField label="Email" hint="Подсказка под полем" />
          <TextField label="С ошибкой" error="Только буквы и цифры" defaultValue="??" />
          <TextField label="Недоступно" disabled defaultValue="значение" />
        </div>
        <div className="kit-row kit-row-top">
          <Select label="Окружение" defaultValue="prod">
            <option value="prod">prod</option>
            <option value="staging">staging</option>
            <option value="dev">dev</option>
          </Select>
          <Select
            label="С ошибкой"
            error="Значение недоступно"
            defaultValue="x"
          >
            <option value="x">вариант</option>
          </Select>
          <Select label="Недоступно" disabled defaultValue="x">
            <option value="x">вариант</option>
          </Select>
        </div>
        <div className="kit-row kit-row-top">
          <SegmentedControl
            legend="Аутентификация"
            value={kitAuth}
            options={[
              { value: 'PASSWORD', label: 'Пароль' },
              { value: 'KEY', label: 'Приватный ключ' },
            ]}
            onChange={setKitAuth}
          />
        </div>
        <div className="kit-col">
          <Checkbox label="Показывать остановленные" />
          <Checkbox label="Только владельцу" hint="Демонстрация подсказки" defaultChecked />
          <Checkbox label="Недоступно" disabled />
        </div>
        <div className="kit-row kit-row-top">
          <Textarea
            label="Textarea (ключ, моно)"
            hint="Для приватных ключей и технического текста"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            mono
            rows={3}
          />
          <Textarea
            label="С ошибкой"
            error="Зашифрованные ключи не поддерживаются"
            rows={3}
          />
        </div>
      </section>

      <section className="kit-section">
        <h2>Callout</h2>
        <p className="kit-note">
          Inline-результат операции на месте действия; warn/danger — role=alert.
        </p>
        <div className="kit-col">
          <Callout tone="ok">Соединение установлено · Docker 27.1.1 · 42 мс</Callout>
          <Callout tone="info">
            Первое подключение создаёт владелец пространства.
          </Callout>
          <Callout tone="warn">
            SSH работает, но Docker недоступен — нет прав на сокет.{' '}
            <span className="mono">(DOCKER_PERMISSION_DENIED)</span>
          </Callout>
          <Callout tone="danger">
            Сервер отклонил аутентификацию: проверьте имя пользователя и ключ/пароль.{' '}
            <span className="mono">(AUTH_FAILED)</span>
          </Callout>
        </div>
      </section>

      <section className="kit-section">
        <h2>Chip / StatusBadge / Spinner / Skeleton</h2>
        <p className="kit-note">
          Chip — метки без доменного смысла. StatusBadge — доменные статусы
          (словари бэкенда), неизвестное значение показывается как есть.
        </p>
        <div className="kit-row">
          <Chip tone="ok">онлайн</Chip>
          <Chip tone="warn">устарело</Chip>
          <Chip tone="danger">сбой</Chip>
          <Chip tone="info">в очереди</Chip>
          <Chip tone="neutral">не установлен</Chip>
          <Chip tone="accent">владелец</Chip>
          <Spinner />
        </div>
        <div className="kit-row">
          <StatusBadge meta={serverStatus('ONLINE')} />
          <StatusBadge meta={serverStatus('PENDING')} />
          <StatusBadge meta={agentStatus('STALE')} />
          <StatusBadge meta={agentStatus('FAILED')} />
          <StatusBadge meta={deploymentStatus('RUNNING')} />
          <StatusBadge meta={containerState('dead')} />
          <StatusBadge meta={serverStatus('MAINTENANCE')} />
        </div>
        <div className="kit-row">
          <StatusBadge meta={serverStatus('ONLINE')} iconOnly />
          <StatusBadge meta={serverStatus('OFFLINE')} iconOnly />
          <StatusBadge meta={serverStatus('PENDING')} iconOnly />
          <StatusBadge meta={agentStatus('ACTIVE')} iconOnly />
          <StatusBadge meta={agentStatus('STALE')} iconOnly />
          <StatusBadge meta={agentStatus('FAILED')} iconOnly />
          <StatusBadge meta={agentStatus('NOT_INSTALLED')} iconOnly />
        </div>
        <p className="kit-note">
          iconOnly — компактная форма (только глиф, подпись статуса — в tooltip и
          aria-label). В карточках серверов не применяется: там статусов нет.
        </p>
        <div className="kit-col">
          <Skeleton w={240} />
          <Skeleton lines={3} />
        </div>
      </section>

      <section className="kit-section">
        <h2>StepProgress / LogPanel</h2>
        <p className="kit-note">
          Конвейер фаз деплоя и журнал исполнения. StepProgress красит текущую
          фазу по исходу задачи; LogPanel прилипает к хвосту, пока пользователь
          не отлистал вверх.
        </p>
        <div className="kit-col">
          <StepProgress step="build" status="RUNNING" />
          <StepProgress step="run" status="FAILED" />
          <StepProgress step="source" status="INTERRUPTED" />
          <StepProgress step={null} status="QUEUED" />
          <StepProgress step="run" status="SUCCESS" />
        </div>
        <div className="kit-col">
          <LogPanel
            className="kit-log"
            log={
              "==> [preflight] docker 27.1.1, git 2.45.2\n==> [source] git clone --branch main https://github.com/acme/app\nCloning into 'app'...\n==> [build] docker build -f Dockerfile -t bios-deploy:01a1 .\nStep 1/6 : FROM node:22-alpine\n"
            }
            sizeBytes={15243}
            finished={false}
            paused={kitPaused}
            onTogglePause={() => setKitPaused((value) => !value)}
          />
          <LogPanel
            className="kit-log"
            log=""
            sizeBytes={0}
            finished
            onRefresh={() => undefined}
          />
        </div>
      </section>

      <section className="kit-section">
        <h2>Timestamp</h2>
        <div className="kit-row">
          <Timestamp iso={FIVE_MIN_AGO_ISO} />
          <Timestamp iso="2026-10-11T09:52:00Z" absolute />
          <Timestamp iso={null} />
        </div>
      </section>

      <section className="kit-section">
        <h2>OsIcon</h2>
        <p className="kit-note">
          Бейдж ОС по строке пробы (hostnamectl → uname): буква семейства и тихий
          тинт; «?» — хост ещё не опрошен; незнакомое семейство не подменяется.
        </p>
        <div className="kit-row">
          <OsIcon osName="Ubuntu 22.04.3 LTS" />
          <OsIcon osName="Debian GNU/Linux 12 (bookworm)" />
          <OsIcon osName="CentOS Linux 7 (Core)" />
          <OsIcon osName="Red Hat Enterprise Linux 9.2 (Plow)" />
          <OsIcon osName="Fedora Linux 38 (Server Edition)" />
          <OsIcon osName="Rocky Linux 9.2 (Blue Onyx)" />
          <OsIcon osName="AlmaLinux 9.2 (Turquoise Kodkod)" />
          <OsIcon osName="openSUSE Leap 15.5" />
          <OsIcon osName="Arch Linux" />
          <OsIcon osName="Alpine Linux v3.18" />
          <OsIcon osName="Linux 3.10.0-1160.el7.x86_64 (x86_64)" />
          <OsIcon osName="FreeBSD 14.0-RELEASE" />
          <OsIcon osName={null} />
        </div>
      </section>

      <section className="kit-section">
        <h2>Breadcrumbs / PageHeader / Toolbar</h2>
        <Breadcrumbs
          items={[
            { label: 'Пространства', to: '/kit' },
            { label: 'prod', to: '/kit' },
            { label: 'Серверы' },
          ]}
        />
        <PageHeader
          title="Заголовок страницы"
          meta={<span>Пояснение под заголовком: 4 сервера, обновлено только что</span>}
          actions={
            <>
              <IconButton label="Обновить" icon={<RefreshCw size={14} aria-hidden />} />
              <Button variant="primary" icon={<Plus size={14} aria-hidden />}>
                Добавить
              </Button>
            </>
          }
        />
        <Toolbar actions={<Button size="sm">Действие</Button>}>
          Обычная панель инструментов
        </Toolbar>
        <Toolbar busy>Панель в состоянии «идёт обновление»</Toolbar>
      </section>

      <section className="kit-section">
        <h2>Table</h2>
        <Table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Состояние</th>
              <th className="numeric">Перезапусков</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">api-1</td>
              <td>
                <Chip tone="ok">работает</Chip>
              </td>
              <td className="numeric">0</td>
            </tr>
            <tr>
              <td className="mono">worker-2</td>
              <td>
                <Chip tone="danger">остановлен</Chip>
              </td>
              <td className="numeric">3</td>
            </tr>
          </tbody>
        </Table>
      </section>

      <section className="kit-section">
        <h2>EmptyState / ErrorState</h2>
        <EmptyState
          icon={<Server size={22} aria-hidden />}
          title="Серверов пока нет"
          description="Добавьте первый сервер, чтобы видеть контейнеры и деплои."
          action={<Button variant="primary">Добавить сервер</Button>}
        />
        <ErrorState
          title="Панель недоступна"
          description="Нет соединения с сервером панели."
          onRetry={() => undefined}
        />
      </section>

      <section className="kit-section">
        <h2>Modal / ConfirmDialog / Drawer</h2>
        <div className="kit-row">
          <Button onClick={() => setModalOpen(true)}>Открыть модалку</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Опасное подтверждение
          </Button>
          <Button onClick={() => setConfirmPrimaryOpen(true)}>
            Обычное подтверждение
          </Button>
          <Button onClick={() => setDrawerOpen(true)}>Открыть шторку</Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Пример модалки"
          footer={
            <>
              <Button onClick={() => setModalOpen(false)}>Отмена</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                Подтвердить
              </Button>
            </>
          }
        >
          <TextField label="Имя" placeholder="Введите имя" />
        </Modal>
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Перезапустить prod-1?"
          description="Контейнеры получат SIGTERM и будут подняты заново. Активные соединения прервутся."
          confirmLabel="Перезапустить"
          onConfirm={() => setConfirmOpen(false)}
        />
        <ConfirmDialog
          open={confirmPrimaryOpen}
          onClose={() => setConfirmPrimaryOpen(false)}
          title="Переустановить агент?"
          description="Соединение с сервером прервётся примерно на минуту."
          confirmLabel="Переустановить"
          tone="primary"
          onConfirm={() => setConfirmPrimaryOpen(false)}
        />
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel="Детали сервера prod-1"
          title={
            <>
              <OsIcon osName="Ubuntu 22.04.3 LTS" />
              <span className="sv-drawer-name">prod-1</span>
            </>
          }
        >
          <dl className="sv-dl">
            <dt>ОС</dt>
            <dd>Ubuntu 22.04.3 LTS</dd>
            <dt>Хост</dt>
            <dd className="mono">prod-1.internal:22</dd>
            <dt>Пользователь</dt>
            <dd className="mono">deploy</dd>
            <dt>Аутентификация</dt>
            <dd>приватный ключ</dd>
            <dt>Docker</dt>
            <dd className="mono">27.3.1</dd>
          </dl>
          <h3 className="sv-drawer-h">Состояние</h3>
          <dl className="sv-dl">
            <dt>Статус</dt>
            <dd>
              <StatusBadge meta={serverStatus('ONLINE')} />
            </dd>
            <dt>Последняя проверка</dt>
            <dd>
              <Timestamp iso={FIVE_MIN_AGO_ISO} />
            </dd>
            <dt>Агент</dt>
            <dd>
              <StatusBadge meta={agentStatus('ACTIVE')} />
            </dd>
          </dl>
        </Drawer>
      </section>

      <ScenarioSection />
    </div>
  );
}

const SCENARIO_SERVERS = [
  {
    id: '1',
    name: 'prod-1',
    user: 'deploy',
    os: 'Ubuntu 22.04.3 LTS',
  },
  {
    id: '2',
    name: 'prod-2',
    user: 'root',
    os: 'Debian GNU/Linux 12 (bookworm)',
  },
  {
    id: '3',
    name: 'staging-worker-with-a-very-long-hostname.example.internal',
    user: 'ubuntu',
    os: 'CentOS Linux 7 (Core)',
  },
  {
    id: '4',
    name: 'edge-1',
    user: 'edge',
    os: null,
  },
  {
    id: '5',
    name: 'prod-3',
    user: 'deploy',
    os: 'Red Hat Enterprise Linux 9.2 (Plow)',
  },
  {
    id: '6',
    name: 'backup-1',
    user: 'backup',
    os: 'FreeBSD 14.0-RELEASE',
  },
];

/**
 * Сценарий ICC: список серверов карточками — тот же состав, что на странице
 * (шапка с ОС и пользователем, длинные имена, LoadMore).
 * Проверка «реального» состава.
 */
function ScenarioSection() {
  const [visible, setVisible] = useState(4);
  const shown = SCENARIO_SERVERS.slice(0, visible);

  return (
    <section className="kit-section">
      <h2>Сценарий ICC: список серверов</h2>
      <PageHeader
        title="Серверы"
        breadcrumbs={[
          { label: 'Пространства', to: '/kit' },
          { label: 'prod', to: '/kit' },
          { label: 'Серверы' },
        ]}
        actions={
          <>
            <IconButton label="Обновить" icon={<RefreshCw size={14} aria-hidden />} />
            <Button variant="primary" icon={<Plus size={14} aria-hidden />}>
              Добавить сервер
            </Button>
          </>
        }
      />
      <Toolbar>
        {shown.length} из {SCENARIO_SERVERS.length} серверов
      </Toolbar>
      <ul className="sv-grid stagger" role="list">
        {shown.map((server) => (
          <li key={server.id} className="sv-card">
            <div className="sv-card-head">
              <OsIcon osName={server.os} />
              <div className="sv-card-id">
                <div className="sv-name" title={server.name}>
                  {server.name}
                </div>
                <div className="sv-user" title={`SSH: ${server.user}`}>
                  {server.user}
                </div>
              </div>
              <IconButton
                label="Проверить"
                size="sm"
                icon={<PlugZap size={14} aria-hidden />}
              />
            </div>
          </li>
        ))}
      </ul>
      <LoadMore
        onClick={() => setVisible((v) => v + 2)}
        exhausted={visible >= SCENARIO_SERVERS.length}
      />
    </section>
  );
}
