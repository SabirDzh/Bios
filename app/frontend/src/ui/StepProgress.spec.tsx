import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { StepProgress } from './StepProgress';

function items(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.steps-item'));
}

test('RUNNING: пройденные — выполнены, текущий помечен aria-current и вращается', () => {
  const { container } = render(<StepProgress step="build" status="RUNNING" />);
  const steps = items(container);
  expect(steps.map((el) => el.getAttribute('data-state'))).toEqual([
    'done',
    'done',
    'active',
    'future',
  ]);
  expect(steps[2]).toHaveAttribute('aria-current', 'step');
  expect(steps[2]).toHaveAttribute('data-tone', 'info');
  expect(steps[2].querySelector('.spin')).not.toBeNull();
  expect(screen.getByRole('list', { name: 'Этапы деплоя' })).toBeInTheDocument();
});

test('SUCCESS: все шаги выполнены, активного нет', () => {
  const { container } = render(<StepProgress step="run" status="SUCCESS" />);
  const steps = items(container);
  expect(steps.every((el) => el.getAttribute('data-state') === 'done')).toBe(true);
  expect(container.querySelector('[aria-current]')).toBeNull();
  expect(container.querySelector('.spin')).toBeNull();
});

test('QUEUED без шага: ничего не подсвечено и не крутится', () => {
  const { container } = render(<StepProgress step={null} status="QUEUED" />);
  const steps = items(container);
  expect(steps.every((el) => el.getAttribute('data-state') === 'future')).toBe(true);
  expect(container.querySelector('.spin')).toBeNull();
  expect(screen.getByText('Проверка')).toBeInTheDocument();
});

test('FAILED: упавший шаг красный, не вращается', () => {
  const { container } = render(<StepProgress step="run" status="FAILED" />);
  const steps = items(container);
  expect(steps[3]).toHaveAttribute('data-state', 'active');
  expect(steps[3]).toHaveAttribute('data-tone', 'danger');
  expect(container.querySelector('.spin')).toBeNull();
});

test('INTERRUPTED: прерванный шаг жёлтый', () => {
  const { container } = render(<StepProgress step="source" status="INTERRUPTED" />);
  expect(items(container)[1]).toHaveAttribute('data-tone', 'warn');
});

test('незнакомый шаг показывается хвостом, а не теряется', () => {
  const { container } = render(<StepProgress step="migrate" status="RUNNING" />);
  const steps = items(container);
  expect(steps).toHaveLength(5);
  expect(steps[4]).toHaveAttribute('data-state', 'active');
  expect(steps[4]).toHaveTextContent('migrate');
});
