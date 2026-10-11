import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('значение меняется только после паузы', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'p' } },
    );

    rerender({ value: 'pr' });
    rerender({ value: 'prod' });
    expect(result.current).toBe('p');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('p');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('prod');
  });

  test('каждая правка сбрасывает предыдущий таймер', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('abc');
  });
});
