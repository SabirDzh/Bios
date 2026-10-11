import { apiGet, apiPost } from './client';
import type { ApiFetchOptions } from './client';
import type {
  CreateDeploymentInput,
  Deployment,
  DeploymentListParams,
  DeploymentLogs,
} from './types';

/** get/logs живут на плоском контроллере `/deployments` (workspace в пути нет). */
export const deploymentsApi = {
  /** 202 Accepted: запись создана, исполняет фоновый обработчик. */
  create(
    workspaceId: string,
    input: CreateDeploymentInput,
    init?: ApiFetchOptions,
  ): Promise<Deployment> {
    return apiPost<Deployment>(
      `/workspaces/${workspaceId}/deployments`,
      input,
      init,
    );
  },
  list(
    workspaceId: string,
    params?: DeploymentListParams,
    init?: ApiFetchOptions,
  ): Promise<Deployment[]> {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.configId) qs.set('configId', params.configId);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const suffix = query ? `?${query}` : '';
    return apiGet<Deployment[]>(
      `/workspaces/${workspaceId}/deployments${suffix}`,
      init,
    );
  },
  get(deploymentId: string, init?: ApiFetchOptions): Promise<Deployment> {
    return apiGet<Deployment>(`/deployments/${deploymentId}`, init);
  },
  logs(deploymentId: string, init?: ApiFetchOptions): Promise<DeploymentLogs> {
    return apiGet<DeploymentLogs>(`/deployments/${deploymentId}/logs`, init);
  },
};
