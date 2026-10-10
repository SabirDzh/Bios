import { apiGet } from './client';

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiGet<HealthResponse>('/health', { retryOnAuth: false });
}
