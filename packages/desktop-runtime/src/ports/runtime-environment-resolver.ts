import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

export type RuntimeEnvironmentResolveInput = {
  projectId?: string;
  workspaceId?: string;
  threadId: string;
  threadCreatedAt?: string;
};

export type RuntimeEnvironmentResolver = {
  resolve(input: RuntimeEnvironmentResolveInput): Promise<RuntimeEnvironment>;
};
