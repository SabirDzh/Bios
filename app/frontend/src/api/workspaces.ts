import { apiGet, apiPost } from './client';
import type {
  AcceptInvitationInput,
  CreateWorkspaceInput,
  Invitation,
  InviteMemberInput,
  Membership,
  Workspace,
} from './types';

export const workspacesApi = {
  list(): Promise<Workspace[]> {
    return apiGet<Workspace[]>('/workspaces');
  },
  get(workspaceId: string): Promise<Workspace> {
    return apiGet<Workspace>(`/workspaces/${workspaceId}`);
  },
  create(input: CreateWorkspaceInput): Promise<Workspace> {
    return apiPost<Workspace>('/workspaces', input);
  },
  invite(workspaceId: string, input: InviteMemberInput): Promise<Invitation> {
    return apiPost<Invitation>(`/workspaces/${workspaceId}/invitations`, input);
  },
  accept(workspaceId: string, input: AcceptInvitationInput): Promise<Membership> {
    return apiPost<Membership>(`/workspaces/${workspaceId}/accept`, input);
  },
};
