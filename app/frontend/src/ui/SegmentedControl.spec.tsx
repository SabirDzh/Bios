import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'PASSWORD', label: 'Пароль' },
  { value: 'KEY', label: 'Приватный ключ' },
] as const;

test('нативные radio в группе: выбран один, подпись группы — legend', () => {
  render(
    <SegmentedControl
      legend="Аутентификация"
      value="PASSWORD"
      options={[...OPTIONS]}
      onChange={() => undefined}
    />,
  );
  expect(
    screen.getByRole('group', { name: 'Аутентификация' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Пароль' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Приватный ключ' })).not.toBeChecked();
  expect(
    screen
      .getByRole('radio', { name: 'Пароль' })
      .closest('.segmented-option'),
  ).toHaveAttribute('data-checked', 'true');
});

test('выбор другого сегмента зовёт onChange', async () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      legend="Аутентификация"
      value="PASSWORD"
      options={[...OPTIONS]}
      onChange={onChange}
    />,
  );
  await userEvent.click(screen.getByRole('radio', { name: 'Приватный ключ' }));
  expect(onChange).toHaveBeenCalledWith('KEY');
});
