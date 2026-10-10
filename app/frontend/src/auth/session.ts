import { createContext, useContext } from 'react';
import type { LoginInput, SessionUser } from '../api/types';

export type SessionStatus = 'checking' | 'anonymous' | 'authenticated';

export interface SessionValue {
  status: SessionStatus;
  user: SessionUser | null;
  /** Сервер сессии недоступен (сеть/5xx): это не «выход», редирект не делаем. */
  sessionError: boolean;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  reload(): void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
