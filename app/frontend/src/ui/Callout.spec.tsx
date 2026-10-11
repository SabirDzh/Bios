import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Callout } from './Callout';

test('danger объявляется через alert, ok — через status', () => {
  const { rerender } = render(<Callout tone="danger">Ошибка соединения</Callout>);
  expect(screen.getByRole('alert')).toHaveTextContent('Ошибка соединения');
  rerender(<Callout tone="ok">Соединение установлено</Callout>);
  expect(screen.getByRole('status')).toHaveTextContent('Соединение установлено');
});

test('тон задаёт класс и модификатор', () => {
  render(<Callout tone="warn">Docker недоступен</Callout>);
  expect(screen.getByRole('alert')).toHaveClass('callout-warn');
});
