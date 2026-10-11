import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { LogPanel } from './LogPanel';

function logBody(container: HTMLElement): HTMLPreElement {
  const pre = container.querySelector('pre');
  if (!pre) throw new Error('pre not found');
  return pre as HTMLPreElement;
}

/** jsdom не считает layout: метрики скролла задаём вручную. */
function mockScroll(
  el: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
  scrollTop = 0,
): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
}

test('пустой журнал: «Пока пусто» и нет копирования', () => {
  render(<LogPanel log="" sizeBytes={0} finished={false} />);
  expect(screen.getByText('Пока пусто')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Копировать/ })).toBeNull();
});

test('шапка: размер и текст журнала', () => {
  render(<LogPanel log="step 1" sizeBytes={1536} finished={false} />);
  expect(screen.getByText('1.5 КБ')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Журнал' })).toBeInTheDocument();
  expect(logBody(document.body)).toHaveTextContent('step 1');
});

test('кнопки по состоянию: идёт → «Пауза», пауза → «Продолжить» и «Обновить», конец → «Обновить»', () => {
  const onTogglePause = vi.fn();
  const onRefresh = vi.fn();
  const { rerender } = render(
    <LogPanel
      log="x"
      finished={false}
      onTogglePause={onTogglePause}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
  expect(onTogglePause).toHaveBeenCalledTimes(1);

  rerender(
    <LogPanel
      log="x"
      finished={false}
      paused
      onTogglePause={onTogglePause}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(onTogglePause).toHaveBeenCalledTimes(2);
  expect(onRefresh).toHaveBeenCalledTimes(1);

  rerender(<LogPanel log="x" finished onRefresh={onRefresh} />);
  expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
});

test('«Перенос» переключает pre-wrap через aria-pressed', () => {
  const { container } = render(<LogPanel log={'a\nb'} finished />);
  const toggle = screen.getByRole('button', { name: 'Перенос' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(logBody(container).className).not.toContain('log-wrap');

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(logBody(container).className).toContain('log-wrap');
});

test('отлистал вверх — появляется «К низу» и возвращает к хвосту', () => {
  const { container } = render(<LogPanel log={'line\n'.repeat(50)} finished />);
  const pre = logBody(container);
  mockScroll(pre, 500, 300, 100);
  fireEvent.scroll(pre);

  const jump = screen.getByRole('button', { name: 'К низу' });
  fireEvent.click(jump);
  expect(pre.scrollTop).toBe(500);
  expect(screen.queryByRole('button', { name: 'К низу' })).toBeNull();
});

test('у низа новый текст ведёт скролл за собой', () => {
  const { container, rerender } = render(<LogPanel log="первая" finished />);
  const pre = logBody(container);
  mockScroll(pre, 640, 300, 0);

  rerender(<LogPanel log={'первая\nвторая'} finished />);
  expect(pre.scrollTop).toBe(640);
});
