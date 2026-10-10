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
