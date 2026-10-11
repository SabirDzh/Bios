import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

test('фокус на «Отмена», подтверждение и закрытие', async () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      onClose={onClose}
      title="Перезапустить prod-1?"
      description="Активные соединения прервутся."
      confirmLabel="Перезапустить"
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText('Активные соединения прервутся.')).toBeInTheDocument();
  const cancel = screen.getByRole('button', { name: 'Отмена' });
  await waitFor(() => expect(cancel).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Перезапустить' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await userEvent.click(cancel);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('tone=primary использует основную кнопку, danger — опасную', () => {
  render(
    <ConfirmDialog
      open
      onClose={() => undefined}
      title="Переустановить агент?"
      confirmLabel="Переустановить"
      tone="primary"
      onConfirm={() => undefined}
    />,
  );
  expect(screen.getByRole('button', { name: 'Переустановить' })).toHaveClass('btn-primary');
});

test('danger по умолчанию — сплошная опасная кнопка', () => {
  render(
    <ConfirmDialog
      open
      onClose={() => undefined}
      title="Удалить сервер?"
      confirmLabel="Удалить"
      onConfirm={() => undefined}
    />,
  );
  expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass('btn-danger-solid');
});
