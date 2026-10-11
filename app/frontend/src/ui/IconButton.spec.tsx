import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefreshCw, RotateCw } from 'lucide-react';
import { expect, test, vi } from 'vitest';
import { IconButton } from './IconButton';

test('доступное имя и title по умолчанию', () => {
  render(<IconButton label="Обновить" icon={<RefreshCw size={14} aria-hidden />} />);
  const button = screen.getByRole('button', { name: 'Обновить' });
  expect(button).toHaveAttribute('title', 'Обновить');
  expect(button).toHaveAttribute('type', 'button');
});

test('клик вызывает обработчик', async () => {
  const onClick = vi.fn();
  render(
    <IconButton
      label="Перезапустить"
      icon={<RotateCw size={14} aria-hidden />}
      onClick={onClick}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Перезапустить' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});
