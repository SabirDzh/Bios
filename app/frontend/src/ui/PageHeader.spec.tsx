import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { PageHeader } from './PageHeader';

test('заголовок, крошки, мета и действия', () => {
  render(
    <MemoryRouter>
      <PageHeader
        title="Серверы"
        breadcrumbs={[
          { label: 'Пространства', to: '/ws' },
          { label: 'prod', to: '/w/1' },
          { label: 'Серверы' },
        ]}
        meta={<span>4 сервера</span>}
        actions={<button type="button">Добавить</button>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Серверы' })).toBeInTheDocument();
  expect(screen.getByText('4 сервера')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Хлебные крошки' })).toBeInTheDocument();
});

test('без крошек и действий', () => {
  render(<PageHeader title="Пространства" />);
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Пространства');
});
