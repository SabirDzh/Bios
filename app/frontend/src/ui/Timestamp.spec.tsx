import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Timestamp } from './Timestamp';

afterEach(() => {
  vi.useRealTimers();
});

test('относительное время, точное — в подсказке', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  render(<Timestamp iso="2026-10-11T11:30:00Z" />);
  const el = screen.getByText('30 мин назад');
  expect(el.getAttribute('title')).toMatch(/\d{2}:\d{2}/);
});

test('absolute показывает точное время, title совпадает с текстом', () => {
  render(<Timestamp iso="2026-10-11T09:52:00Z" absolute />);
  const el = screen.getByText(/\d{2}:\d{2}/);
  expect(el.getAttribute('title')).toBe(el.textContent);
});

test('пустое значение — прочерк с пометкой', () => {
  render(<Timestamp iso={null} />);
  const el = screen.getByText('—');
  expect(el).toHaveClass('timestamp-missing');
  expect(el).toHaveAttribute('title', '—');
});
