import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SortableTh } from './SortableTh';

function renderTh(direction: 'asc' | 'desc' | null, onToggle = () => undefined) {
  return render(
    <table>
      <thead>
        <tr>
          <SortableTh direction={direction} onToggle={onToggle}>
            Сервер
          </SortableTh>
        </tr>
      </thead>
    </table>,
  );
}

test('aria-sort отражает направление', () => {
  renderTh('asc');
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
});

test('невыбранная колонка — aria-sort=none и клик переключает', async () => {
  const onToggle = vi.fn();
  renderTh(null, onToggle);
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  await userEvent.click(screen.getByRole('button', { name: 'Сервер' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
