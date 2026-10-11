import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Textarea } from './Textarea';

test('label связан, ввод работает, mono — класс', async () => {
  render(<Textarea label="Приватный ключ" mono />);
  const area = screen.getByLabelText('Приватный ключ');
  expect(area).toHaveClass('field-mono');
  await userEvent.type(area, '-----BEGIN OPENSSH PRIVATE KEY-----');
  expect(area).toHaveValue('-----BEGIN OPENSSH PRIVATE KEY-----');
});

test('ошибка заменяет подсказку и объявляется', () => {
  render(
    <Textarea label="Ключ" hint="Подсказка" error="Не PEM-ключ" defaultValue="??" />,
  );
  const area = screen.getByLabelText('Ключ');
  expect(area).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Не PEM-ключ');
  expect(screen.queryByText('Подсказка')).toBeNull();
});
