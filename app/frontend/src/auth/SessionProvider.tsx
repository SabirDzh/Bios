import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { authKeys } from '../api/keys';
import { ApiError } from '../api/client';
import type { LoginInput } from '../api/types';
import { SessionContext, type SessionStatus, type SessionValue } from './session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: authKeys.session(),
    queryFn: authApi.me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<SessionValue>(() => {
    let status: SessionStatus = 'checking';
    let sessionError = false;

    if (query.data) {
      status = 'authenticated';
    } else if (query.isError) {
      if (query.error instanceof ApiError && query.error.status === 401) {
        status = 'anonymous';
      } else if (query.error instanceof ApiError && query.error.status === 429) {
        // Лимит на auth-маршрутах: панель жива, просто просит подождать.
        // Показываем вход — его собственный текст лимита честно объяснит паузу.
        status = 'anonymous';
      } else {
        sessionError = true;
      }
    } else if (query.isSuccess) {
      status = 'anonymous';
    }

    return {
      status,
      user: query.data ?? null,
      sessionError,
      async login(input: LoginInput) {
        await authApi.login(input);
        await queryClient.fetchQuery({
          queryKey: authKeys.session(),
          queryFn: authApi.me,
        });
      },
      async logout() {
        try {
          await authApi.logout();
        } catch {
          // Сеть могла отвалиться после очистки куки сервером —
          // локально выходим в любом случае.
        }
        // Сначала помечаем сессию анонимной: гейты мгновенно уводят на вход,
        // и только потом снимаем кэш данных — иначе активные запросы успевают
        // сходить в API без куки и мигнуть ошибкой «не удалось загрузить».
        queryClient.setQueryData(authKeys.session(), null);
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== authKeys.all[0],
        });
      },
      reload() {
        void query.refetch();
      },
    };
  }, [query, queryClient]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
