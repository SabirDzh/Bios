import { useState } from 'react';
import { Server } from 'lucide-react';
import { Button } from './Button';
import { Chip } from './Chip';
import { CopyButton } from './CopyButton';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { Table } from './Table';
import { TextField } from './TextField';
import './KitPage.css';

/**
 * Витрина примитивов — только dev-сборка (маршрут /kit).
 * Данные здесь синтетические и подписаны как витрина; в приложение
 * из этого файла не попадает ни одно значение.
 */
export function KitPage() {
  const [modalOpen, setModalOpen] = useState(false);

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
          <Button loading>Загрузка</Button>
          <Button disabled>Недоступна</Button>
          <Button size="sm" variant="primary">
            Малая
          </Button>
        </div>
      </section>

      <section className="kit-section">
        <h2>TextField</h2>
        <div className="kit-row kit-row-top">
          <TextField label="Имя" placeholder="prod-1" />
          <TextField label="Email" hint="Подсказка под полем" />
          <TextField label="С ошибкой" error="Только буквы и цифры" defaultValue="??" />
          <TextField label="Недоступно" disabled defaultValue="значение" />
        </div>
      </section>

      <section className="kit-section">
        <h2>Chip / Spinner / Skeleton</h2>
        <div className="kit-row">
          <Chip tone="ok">онлайн</Chip>
          <Chip tone="warn">устарело</Chip>
          <Chip tone="danger">сбой</Chip>
          <Chip tone="info">в очереди</Chip>
          <Chip tone="neutral">не установлен</Chip>
          <Chip tone="accent">владелец</Chip>
          <Spinner />
        </div>
        <div className="kit-col">
          <Skeleton w={240} />
          <Skeleton lines={3} />
        </div>
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
        <h2>Modal / CopyButton</h2>
        <div className="kit-row">
          <Button onClick={() => setModalOpen(true)}>Открыть модалку</Button>
          <CopyButton value="bios://join/demo/demo-token" label="Скопировать пример" />
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
      </section>
    </div>
  );
}
