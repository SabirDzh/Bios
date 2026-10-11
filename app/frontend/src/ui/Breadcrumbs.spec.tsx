import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';

test('ссылки в узлах, текущий узел помечен', () => {
  render(
    <MemoryRouter>
      <Breadcrumbs
        items={[
          { label: 'Пространства', to: '/ws' },
          { label: 'prod', to: '/w/1' },
          { label: 'Серверы' },
        ]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('navigation', { name: 'Хлебные крошки' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Пространства' })).toHaveAttribute('href', '/ws');
  const current = screen.getByText('Серверы');
  expect(current).toHaveAttribute('aria-current', 'page');
});

test('пустой список не рендерит навигацию', () => {
  const { container } = render(
    <MemoryRouter>
      <Breadcrumbs items={[]} />
    </MemoryRouter>,
  );
  expect(container).toBeEmptyDOMElement();
});
