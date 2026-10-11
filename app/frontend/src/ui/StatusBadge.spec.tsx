import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { deploymentStatus, serverStatus } from '../lib/statusMeta';
import { StatusBadge } from './StatusBadge';

test('подпись, тон и исходное значение в title', () => {
  render(<StatusBadge meta={serverStatus('ONLINE')} />);
  const badge = screen.getByTitle('ONLINE');
  expect(badge).toHaveTextContent('онлайн');
  expect(badge).toHaveClass('status-badge-ok');
});

test('активный процесс вращает глиф', () => {
  const { container } = render(<StatusBadge meta={deploymentStatus('RUNNING')} />);
  expect(container.querySelector('.spin')).not.toBeNull();
});

test('неизвестный статус показывается как есть', () => {
  render(<StatusBadge meta={serverStatus('MAINTENANCE')} />);
  expect(screen.getByTitle('MAINTENANCE')).toHaveTextContent('MAINTENANCE');
});

test('iconOnly: только глиф; смысл — в aria-label и тултипе', () => {
  render(<StatusBadge meta={serverStatus('OFFLINE')} iconOnly />);
  const badge = screen.getByRole('img', { name: 'офлайн' });
  expect(badge).toHaveClass('status-badge-icon');
  expect(badge).toHaveAttribute('title', 'офлайн');
  expect(badge.textContent).toBe('');
});
