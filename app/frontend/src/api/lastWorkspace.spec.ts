import { beforeEach, describe, expect, test } from 'vitest';
import { getLastWorkspaceId, setLastWorkspaceId } from './lastWorkspace';

beforeEach(() => localStorage.clear());

describe('lastWorkspace', () => {
  test('пусто → null', () => {
    expect(getLastWorkspaceId()).toBeNull();
  });

  test('сохраняет и читает', () => {
    setLastWorkspaceId('ws-1');
    expect(getLastWorkspaceId()).toBe('ws-1');
  });

  test('null очищает', () => {
    setLastWorkspaceId('ws-1');
    setLastWorkspaceId(null);
    expect(getLastWorkspaceId()).toBeNull();
  });
});
