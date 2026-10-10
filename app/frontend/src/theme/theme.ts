export type ThemeMode = 'system' | 'dark' | 'light';
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'bios.theme-mode';

export function clampMode(value: unknown): ThemeMode {
  return value === 'dark' || value === 'light' ? value : 'system';
}

export function getThemeMode(): ThemeMode {
  return clampMode(localStorage.getItem(STORAGE_KEY));
}

export function resolveTheme(mode: ThemeMode, mql: MediaQueryList): Theme {
  if (mode !== 'system') return mode;
  return mql.matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(resolveTheme(mode, window.matchMedia('(prefers-color-scheme: dark)')));
}

export function initTheme(): ThemeMode {
  const mode = getThemeMode();
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(resolveTheme(mode, mql));
  mql.addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme(resolveTheme('system', mql));
  });
  return mode;
}
