import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { serversApi } from '../../api/servers';
import { serverKeys } from '../../api/keys';
import type { Server } from '../../api/types';

const PAGE_SIZE = 20;

export function useServerList(workspaceId: string) {
  const query = useInfiniteQuery({
    queryKey: serverKeys.list(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      serversApi.list(workspaceId, { cursor: pageParam, limit: PAGE_SIZE }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: workspaceId !== '',
  });

  const servers: Server[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, servers };
}

/**
 * Серверный поиск: включается только на непустом запросе. Старые результаты
 * видимы, пока едет новый запрос (keepPreviousData) — список не мигает;
 * устаревшие ответы отменяет сам useQuery сменой ключа (signal в queryFn).
 */
export function useServerSearch(workspaceId: string, query: string) {
  return useQuery({
    queryKey: serverKeys.search(workspaceId, query),
    queryFn: ({ signal }) => serversApi.search(workspaceId, query, { signal }),
    enabled: workspaceId !== '' && query !== '',
    placeholderData: keepPreviousData,
  });
}
