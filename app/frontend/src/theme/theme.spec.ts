import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyTheme, clampMode, resolveTheme } from './theme';

const matchMedia = (dark: boolean) => ({ matches: dark }) as MediaQueryList;

beforeEach(() => localStorage.clear());

describe('resolveTheme', () => {
  test('system + тёмная ОС → dark', () => {
    expect(resolveTheme('system', matchMedia(true))).toBe('dark');
  });

  test('system + светлая ОС → light', () => {
    expect(resolveTheme('system', matchMedia(false))).toBe('light');
  });

  test('явный режим сильнее системы', () => {
    expect(resolveTheme('light', matchMedia(true))).toBe('light');
  });
});

describe('clampMode', () => {
  test('неизвестное хранимое значение → system', () => {
    expect(clampMode('neon')).toBe('system');
    expect(clampMode(null)).toBe('system');
  });
});

describe('applyTheme', () => {
  test('проставляет data-theme на html', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    vi.unstubAllGlobals();
  });
});
