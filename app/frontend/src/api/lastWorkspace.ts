const KEY = 'bios.last-workspace';

export function getLastWorkspaceId(): string | null {
  const value = localStorage.getItem(KEY);
  return value && value !== '' ? value : null;
}

export function setLastWorkspaceId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, id);
  }
}
