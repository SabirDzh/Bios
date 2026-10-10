import { apiGet, apiPost, resetRefreshState } from './client';
import type { LoginInput, RegisterInput, SessionUser, User } from './types';

export const authApi = {
  register(input: RegisterInput): Promise<User> {
    return apiPost<User>('/auth/register', input, { retryOnAuth: false });
  },
  /** 200 с пустым телом, сессия приезжает httpOnly-куками. */
  async login(input: LoginInput): Promise<void> {
    await apiPost<void>('/auth/login', input, { retryOnAuth: false });
    // Новая сессия: снимаем блокировку refresh от прошлой мёртвой сессии.
    resetRefreshState();
  },
  me(): Promise<SessionUser> {
    return apiGet<SessionUser>('/auth/me');
  },
  refresh(): Promise<void> {
    return apiPost<void>('/auth/refresh', undefined, { retryOnAuth: false });
  },
  logout(): Promise<void> {
    return apiPost<void>('/auth/logout', undefined, { retryOnAuth: false });
  },
  revoke(): Promise<void> {
    return apiPost<void>('/auth/revoke', undefined, { retryOnAuth: false });
  },
};
