import { useEffect, useState } from 'react';

/**
 * Значение, стабилизированное на delayMs: поиск не бьёт по API на каждый
 * набранный символ, а ждёт паузы. Смена значения сбрасывает таймер.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
