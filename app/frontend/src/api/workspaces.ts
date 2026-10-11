import { apiGet, apiPost, withCursor } from './client';
import type {
  AcceptInvitationInput,
  CreateWorkspaceInput,
  CursorPage,
  CursorParams,
  Invitation,
  InviteMemberInput,
  Membership,
  Workspace,
} from './types';

export const workspacesApi = {
  list(params?: CursorParams): Promise<CursorPage<Workspace>> {
    return apiGet<CursorPage<Workspace>>(withCursor('/workspaces', params));
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
