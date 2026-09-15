import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
export type GitHubTransport = {
  request(path: string, init?: RequestInit): Promise<Response>;
  gitEnvironment(): Promise<Record<string, string>>;
};

export type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
export const pageFields = 'pageInfo { hasNextPage endCursor }';
export const nextCursor = (page: Page<unknown>) => page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
export const actorFields = 'login avatarUrl';
export type Actor = { login: string; avatarUrl: string } | null;
export const actor = (value: Actor) => ({ login: value?.login ?? 'ghost', avatarUrl: value?.avatarUrl ?? null });
export const repoVariables = (repository: string) => {
  const [owner, name] = repository.split('/');
  return { owner, name };
};
export const repoPath = (repository: string) => `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;

/** A rejected request can be corrected; a lost mutation response still needs reconciliation. */
export class GitHubApiFailure extends FeatureOperationFailure {
  constructor(failure: { code: string; message: string }, readonly requestRejected: boolean) {
    super({ ...failure, retryable: false });
  }
}
type GraphQLError = { message: string; type?: string; path?: (string | number)[] };
function graphqlRequestRejected(data: unknown, errors: GraphQLError[]): boolean {
  return errors.length > 0 && errors.every((error) => {
    // GitHub reports validation failures without execution data. Resolver errors can occur
    // after a write, so only explicit rejection at the mutation root is safe to retry.
    if (data == null && !error.path && !error.type) return true;
    if (!['FORBIDDEN', 'NOT_FOUND', 'UNPROCESSABLE', 'RATE_LIMITED'].includes(error.type ?? '')) return false;
    if (data == null) return !error.path || error.path.length === 1;
    return error.path?.length === 1 && typeof data === 'object'
      && (data as Record<string, unknown>)[error.path[0]] === null;
  });
}

/** All requests use the shared account; GraphQL partial errors never masquerade as complete data. */
export class GitHubApi {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly connection: GitHubTransport) {}

  async request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<{ value: T; more: boolean }> {
    const signal = options.signal;
    await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      const response = await this.connection.request(path, {
        method: options.method ?? 'GET', signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const value = await response.json().catch((error: unknown) => {
        if (response.ok) throw error;
        return null;
      }) as T & { message?: string } | null;
      if (!response.ok) {
        const limited = response.status === 429 || (response.status === 403
          && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
        throw new GitHubApiFailure({
          code: limited ? 'GITHUB_RATE_LIMITED' : [401, 403].includes(response.status) ? 'GITHUB_ACCESS_DENIED'
            : response.status === 404 ? 'PR_NOT_FOUND' : response.status === 409 ? 'PR_CHANGED' : 'GITHUB_REQUEST_FAILED',
          message: value?.message ?? `GitHub request failed (${response.status}).`,
        }, [400, 401, 403, 404, 409, 422, 429].includes(response.status));
      }
      return { value: value as T, more: /rel="next"/u.test(response.headers.get('link') ?? '') };
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < 4) { this.active += 1; return; }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        this.active += 1;
        resolve();
      };
      const cancel = () => {
        const index = this.waiting.indexOf(start);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      this.waiting.push(start);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  async graphql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const { value } = await this.request<{ data?: T; errors?: GraphQLError[] }>('/graphql', { method: 'POST', body: { query, variables }, signal });
    if (value.errors?.length || !value.data) {
      throw new GitHubApiFailure({
        code: 'GITHUB_REQUEST_FAILED', message: value.errors?.map((error) => error.message).join('\n') ?? 'GitHub returned no data.',
      }, graphqlRequestRejected(value.data, value.errors ?? []));
    }
    return value.data;
  }
}

export function requestChanged(): never {
  throw new FeatureOperationFailure({ code: 'PR_CHANGED', message: 'The pull request changed. Refresh it before continuing.', retryable: false });
}
