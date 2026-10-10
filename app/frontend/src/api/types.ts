/** Типы повторяют DTO/ответы бэкенда (NestJS). */

/** Курсорная страница list-эндпоинтов: { items, nextCursor }. */
export interface CursorPage<T> {
  items: T[];
  /** null — последняя страница. */
  nextCursor: string | null;
}

export interface CursorParams {
  cursor?: string;
  limit?: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  userId: string;
  username: string;
  email: string;
  sid: string;
}

export type WorkspaceRole = 'OWNER' | 'MEMBER';

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  /** Открытый токен — только в ответе на создание. */
  token: string;
}

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

export interface InviteMemberInput {
  email: string;
}

export interface AcceptInvitationInput {
  token: string;
}
