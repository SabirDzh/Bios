import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../../api/projects';
import { serversApi } from '../../api/servers';
import { projectKeys, serverKeys } from '../../api/keys';
import type { Server } from '../../api/types';

export function useProjectList(workspaceId: string) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId),
    queryFn: ({ signal }) => projectsApi.list(workspaceId, { signal }),
    enabled: workspaceId !== '',
  });
}

export function useProject(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(workspaceId, projectId),
    queryFn: ({ signal }) => projectsApi.get(workspaceId, projectId, { signal }),
    enabled: workspaceId !== '' && projectId !== '',
  });
}

export function useProjectConfigs(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.configs(workspaceId, projectId),
    queryFn: ({ signal }) => projectsApi.configs(workspaceId, projectId, { signal }),
    enabled: workspaceId !== '' && projectId !== '',
  });
}

/**
 * Одна страница серверов (limit 100) — для Select-а конфига и имён в таблице.
 * Тот же кэш, что у серийного списка не занимает: отдельный ключ `options`.
 */
export function useServerOptions(workspaceId: string) {
  return useQuery({
    queryKey: serverKeys.options(workspaceId),
    queryFn: ({ signal }) => serversApi.list(workspaceId, { limit: 100 }, { signal }),
    enabled: workspaceId !== '',
  });
}

export function serverNameOf(servers: Server[], serverId: string): string | null {
  return servers.find((server) => server.id === serverId)?.name ?? null;
}
