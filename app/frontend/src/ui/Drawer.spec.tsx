import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Drawer } from './Drawer';

test('открыт: нативный dialog с доступным именем, фокус на «Закрыть»', async () => {
  render(
    <Drawer
      open
      onClose={() => undefined}
      ariaLabel="Детали сервера prod-1"
      title="prod-1"
    >
      <p>содержимое</p>
    </Drawer>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Детали сервера prod-1' });
  expect(dialog).toHaveAttribute('open');
  expect(screen.getByText('содержимое')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus(),
  );
});

test('клик по подложке (сам dialog) и кнопка «Закрыть» зовут onClose', async () => {
  const onClose = vi.fn();
  render(
    <Drawer open onClose={onClose} ariaLabel="Детали" title="prod-1">
      x
    </Drawer>,
  );
  fireEvent.click(screen.getByRole('dialog'));
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('нативное событие close (Esc) зовёт onClose', () => {
  const onClose = vi.fn();
  render(
    <Drawer open onClose={onClose} ariaLabel="Детали" title="prod-1">
      x
    </Drawer>,
  );
  fireEvent(screen.getByRole('dialog'), new Event('close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('пока шторка открыта, html помечен data-drawer (пуш оболочки)', () => {
  const { unmount } = render(
    <Drawer open onClose={() => undefined} ariaLabel="Детали" title="prod-1">
      x
    </Drawer>,
  );
  expect(document.documentElement.dataset.drawer).toBe('open');
  unmount();
  expect(document.documentElement.dataset.drawer).toBeUndefined();
});
