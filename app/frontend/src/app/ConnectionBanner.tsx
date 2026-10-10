import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';
import { healthKeys } from '../api/keys';
import { useSession } from '../auth/session';

export function ConnectionBanner() {
  const { status } = useSession();
  const authenticated = status === 'authenticated';
  const health = useQuery({
    queryKey: healthKeys.health(),
    queryFn: fetchHealth,
    refetchInterval: authenticated ? 30_000 : false,
    retry: false,
    enabled: authenticated,
  });

  if (!authenticated || !health.isError) return null;

  return (
    <div className="connection-banner" role="status">
      Нет соединения с сервером панели — показаны последние данные.
    </div>
  );
}
