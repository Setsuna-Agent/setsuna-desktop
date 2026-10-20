import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { GitHubApi } from './github-api.js';

export async function assertAccount(api: GitHubApi, expectedAccount: string, signal?: AbortSignal): Promise<void> {
  const { value: viewer } = await api.request<{ login: string }>('/user', { signal });
  assertAccountLogin(viewer.login, expectedAccount);
}

export function assertAccountLogin(login: string | undefined, expectedAccount: string): void {
  if (login?.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new FeatureOperationFailure({ code: 'PR_ACCOUNT_CHANGED', message: 'The GitHub account changed. Confirm the current account before trying again.', retryable: false });
  }
}
