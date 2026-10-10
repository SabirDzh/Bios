import { useInfiniteQuery } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { workspaceKeys } from '../../api/keys';
import type { Workspace } from '../../api/types';

const PAGE_SIZE = 20;

export function useWorkspaceList() {
  const query = useInfiniteQuery({
    queryKey: workspaceKeys.list(),
    queryFn: ({ pageParam }) =>
      workspacesApi.list({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const workspaces: Workspace[] = query.data?.pages.flatMap((p) => p.items) ?? [];

  return { ...query, workspaces };
}
