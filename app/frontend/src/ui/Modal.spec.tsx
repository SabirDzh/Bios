import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Modal } from './Modal';

test('открыт: нативный dialog, «Закрыть» и подложка зовут onClose', async () => {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="Новый сервер">
      содержимое
    </Modal>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Новый сервер' });
  expect(dialog).toHaveClass('modal');
  expect(screen.getByText('содержимое')).toBeInTheDocument();

  fireEvent.click(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('wide добавляет модификатор панели', () => {
  render(
    <Modal open onClose={() => undefined} title="Мастер" wide>
      x
    </Modal>,
  );
  expect(screen.getByRole('dialog', { name: 'Мастер' })).toHaveClass(
    'modal-wide',
  );
});

test('dismissable=false: без крестика, Esc и подложка не закрывают', async () => {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="Новый сервер" dismissable={false}>
      <p>поле</p>
    </Modal>,
  );
  expect(
    screen.queryByRole('button', { name: 'Закрыть' }),
  ).not.toBeInTheDocument();

  const dialog = screen.getByRole('dialog');
  fireEvent.click(dialog);
  expect(onClose).not.toHaveBeenCalled();

  // Esc у нативного dialog — событие cancel: мастер обязан его погасить.
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();

  await waitFor(() => expect(dialog).toHaveAttribute('open'));
});
