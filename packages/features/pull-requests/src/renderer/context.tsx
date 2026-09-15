import { createContext, useContext, useCallback } from 'react';
import type { PullRequestsRendererHost } from './host.js';

export const PullRequestsHostContext = createContext<PullRequestsRendererHost | null>(null);
export function usePullRequestsHost(): PullRequestsRendererHost {
  const value = useContext(PullRequestsHostContext);
  if (!value) throw new Error('Pull request renderer host is unavailable.');
  return value;
}
export function usePrText() {
  const { translate } = usePullRequestsHost();
  return useCallback((key: string, params?: Record<string, string | number>) => translate(`feature.pullRequests.${key}`, params), [translate]);
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
