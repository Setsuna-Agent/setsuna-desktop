import type { FetchImpl } from '../model/provider-http.js';

export type ManagedWorkspaceDependencyNetworkOptions = {
  fetchImpl?: FetchImpl;
  resolveNetworkEnvironment?: () => Promise<Record<string, string | null>>;
};

/** Keeps managed dependency downloads and their child installers on the same route. */
export class ManagedWorkspaceDependencyNetwork {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly options: ManagedWorkspaceDependencyNetworkOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  fetch(url: string): Promise<Response> {
    return this.fetchImpl(url);
  }

  async processEnvironment(): Promise<NodeJS.ProcessEnv> {
    const environment: NodeJS.ProcessEnv = { ...process.env };
    const patch = await this.options.resolveNetworkEnvironment?.() ?? {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete environment[key];
      else environment[key] = value;
    }
    return environment;
  }
}
