import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LoadMore } from './LoadMore';

test('клик вызывает загрузку следующей страницы', async () => {
  const onClick = vi.fn();
  render(<LoadMore onClick={onClick} />);
  await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('кастомная подпись и состояние загрузки', () => {
  render(<LoadMore onClick={() => undefined} loading label="Загрузить контейнеры" />);
  expect(screen.getByRole('button', { name: 'Загрузить контейнеры' })).toBeDisabled();
});

test('exhausted — ничего не рендерится', () => {
  const { container } = render(<LoadMore onClick={() => undefined} exhausted />);
  expect(container).toBeEmptyDOMElement();
});
