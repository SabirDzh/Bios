import { useQuery, useQueries } from '@tanstack/react-query';
import { deploymentsApi } from '../../api/deployments';
import { projectsApi } from '../../api/projects';
import { deploymentKeys, projectKeys } from '../../api/keys';
import type { DeploymentStatus } from '../../api/types';

const FINISHED: DeploymentStatus[] = ['SUCCESS', 'FAILED', 'INTERRUPTED'];

export function isFinished(status: DeploymentStatus | undefined): boolean {
  return status !== undefined && FINISHED.includes(status);
}

interface PollOptions {
  /** Интервал опроса, пока задача не завершена; null — опрос выключен. */
  pollMs: number | null;
}

export function useDeploymentList(
  workspaceId: string,
  params: { projectId?: string; configId?: string; limit?: number },
) {
  return useQuery({
    queryKey: deploymentKeys.list(
      workspaceId,
      params.projectId ?? null,
      params.configId ?? null,
    ),
    queryFn: ({ signal }) => deploymentsApi.list(workspaceId, params, { signal }),
    enabled: workspaceId !== '',
  });
}

/** Опрос прекращается сам, как только статус стал финальным. */
export function useDeployment(
  workspaceId: string,
  deploymentId: string,
  { pollMs }: PollOptions,
) {
  return useQuery({
    queryKey: deploymentKeys.detail(workspaceId, deploymentId),
    queryFn: ({ signal }) => deploymentsApi.get(deploymentId, { signal }),
    enabled: workspaceId !== '' && deploymentId !== '',
    refetchInterval: (query) =>
      pollMs === null || isFinished(query.state.data?.status) ? false : pollMs,
  });
}

export function useDeploymentLogs(
  workspaceId: string,
  deploymentId: string,
  { pollMs }: PollOptions,
) {
  return useQuery({
    queryKey: deploymentKeys.logs(workspaceId, deploymentId),
    queryFn: ({ signal }) => deploymentsApi.logs(deploymentId, { signal }),
    enabled: workspaceId !== '' && deploymentId !== '',
    refetchInterval: (query) =>
      pollMs === null || isFinished(query.state.data?.status) ? false : pollMs,
  });
}

/**
 * Имена конфигов для строк истории: один запрос на каждый встреченный проект
 * (queryKey совпадает с ProjectPage — данные общие, запросы не дублируются).
 */
export function useConfigNames(
  workspaceId: string,
  projectIds: string[],
): Map<string, string> {
  const results = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: projectKeys.configs(workspaceId, projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        projectsApi.configs(workspaceId, projectId, { signal }),
      enabled: workspaceId !== '',
    })),
  });
  const names = new Map<string, string>();
  for (const result of results) {
    for (const config of result.data ?? []) {
      names.set(config.id, config.name);
    }
  }
  return names;
}
