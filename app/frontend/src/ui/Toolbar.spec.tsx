import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Toolbar } from './Toolbar';

test('счётчик и busy-спиннер', () => {
  render(<Toolbar busy>4 из 6 серверов</Toolbar>);
  expect(screen.getByText('4 из 6 серверов')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Обновление' })).toBeInTheDocument();
});

test('без busy спиннера нет, действия рендерятся', () => {
  render(<Toolbar actions={<button type="button">Обновить</button>}>Список</Toolbar>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
});
