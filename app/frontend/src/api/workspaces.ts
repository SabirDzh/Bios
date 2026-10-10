import { apiGet, apiPost } from './client';
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

function withCursor(path: string, params?: CursorParams): string {
  if (!params || (params.cursor === undefined && params.limit === undefined)) {
    return path;
  }
  const qs = new URLSearchParams();
  if (params.cursor !== undefined) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  return `${path}?${qs.toString()}`;
}

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
