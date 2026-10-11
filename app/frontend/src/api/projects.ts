import { apiGet, apiPost } from './client';
import type { ApiFetchOptions } from './client';
import type {
  CreateDeployConfigInput,
  CreateProjectInput,
  DeployConfig,
  Project,
} from './types';

const base = (workspaceId: string) => `/workspaces/${workspaceId}/projects`;

export const projectsApi = {
  /** Плоский список: у проектов нет курсора (см. projects.controller.ts). */
  list(workspaceId: string, init?: ApiFetchOptions): Promise<Project[]> {
    return apiGet<Project[]>(base(workspaceId), init);
  },
  create(
    workspaceId: string,
    input: CreateProjectInput,
    init?: ApiFetchOptions,
  ): Promise<Project> {
    return apiPost<Project>(base(workspaceId), input, init);
  },
  get(
    workspaceId: string,
    projectId: string,
    init?: ApiFetchOptions,
  ): Promise<Project> {
    return apiGet<Project>(`${base(workspaceId)}/${projectId}`, init);
  },
  configs(
    workspaceId: string,
    projectId: string,
    init?: ApiFetchOptions,
  ): Promise<DeployConfig[]> {
    return apiGet<DeployConfig[]>(
      `${base(workspaceId)}/${projectId}/deploy-configs`,
      init,
    );
  },
  createConfig(
    workspaceId: string,
    projectId: string,
    input: CreateDeployConfigInput,
    init?: ApiFetchOptions,
  ): Promise<DeployConfig> {
    return apiPost<DeployConfig>(
      `${base(workspaceId)}/${projectId}/deploy-configs`,
      input,
      init,
    );
  },
};
