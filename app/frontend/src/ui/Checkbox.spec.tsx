import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Checkbox } from './Checkbox';

test('клик по подписи переключает', async () => {
  render(<Checkbox label="Показывать остановленные" />);
  const input = screen.getByRole('checkbox', { name: 'Показывать остановленные' });
  await userEvent.click(screen.getByText('Показывать остановленные'));
  expect(input).toBeChecked();
});

test('hint связан через aria-describedby', () => {
  render(<Checkbox label="Только владельцу" hint="Виден только владельцам" />);
  expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
    'Виден только владельцам',
  );
});

test('disabled недоступен', () => {
  render(<Checkbox label="Недоступно" disabled />);
  expect(screen.getByRole('checkbox')).toBeDisabled();
});
