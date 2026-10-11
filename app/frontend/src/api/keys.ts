/**
 * Query key factories (qk-factory-pattern, qk-array-structure,
 * qk-hierarchical-organization): массивы, иерархия entity → id,
 * все зависимости — в ключе. Готовы к TanStack Query без переделок.
 */
export const authKeys = {
  all: ['auth'],
  session: () => [...authKeys.all, 'session'],
} as const;

export const workspaceKeys = {
  all: ['workspaces'],
  list: () => [...workspaceKeys.all, 'list'],
  detail: (workspaceId: string) => [...workspaceKeys.all, 'detail', workspaceId],
  invitations: (workspaceId: string) => [...workspaceKeys.all, workspaceId, 'invitations'],
} as const;

export const serverKeys = {
  all: ['servers'],
  list: (workspaceId: string) => [...serverKeys.all, 'list', workspaceId],
  /** Неполный набор для Select-ов (limit 100, одна страница) — не infinite-кэш. */
  options: (workspaceId: string) => [...serverKeys.all, 'options', workspaceId],
  /** Поисковая выдача: запрос в ключе — кэш на пару (пространство, запрос). */
  search: (workspaceId: string, query: string) => [
    ...serverKeys.all,
    'search',
    workspaceId,
    query,
  ],
} as const;

export const projectKeys = {
  all: ['projects'],
  list: (workspaceId: string) => [...projectKeys.all, 'list', workspaceId],
  detail: (workspaceId: string, projectId: string) => [
    ...projectKeys.all,
    'detail',
    workspaceId,
    projectId,
  ],
  configs: (workspaceId: string, projectId: string) => [
    ...projectKeys.all,
    'configs',
    workspaceId,
    projectId,
  ],
} as const;

export const deploymentKeys = {
  all: ['deployments'],
  list: (workspaceId: string, projectId: string | null, configId: string | null) => [
    ...deploymentKeys.all,
    'list',
    workspaceId,
    projectId,
    configId,
  ],
  detail: (workspaceId: string, deploymentId: string) => [
    ...deploymentKeys.all,
    'detail',
    workspaceId,
    deploymentId,
  ],
  logs: (workspaceId: string, deploymentId: string) => [
    ...deploymentKeys.all,
    'logs',
    workspaceId,
    deploymentId,
  ],
} as const;

export const healthKeys = {
  health: () => ['health'],
} as const;
