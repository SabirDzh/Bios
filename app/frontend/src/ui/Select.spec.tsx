import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Select } from './Select';

test('label связан с select, ошибка объявляется', () => {
  render(
    <Select label="Окружение" error="Значение недоступно" defaultValue="prod">
      <option value="prod">prod</option>
      <option value="staging">staging</option>
    </Select>,
  );
  const select = screen.getByLabelText('Окружение');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Значение недоступно');
});

test('подсказка связана, выбор работает', async () => {
  render(
    <Select label="Окружение" hint="Влияет на деплой" defaultValue="prod">
      <option value="prod">prod</option>
      <option value="staging">staging</option>
    </Select>,
  );
  const select = screen.getByLabelText('Окружение');
  expect(select).toHaveAccessibleDescription('Влияет на деплой');
  await userEvent.selectOptions(select, 'staging');
  expect(select).toHaveValue('staging');
});
