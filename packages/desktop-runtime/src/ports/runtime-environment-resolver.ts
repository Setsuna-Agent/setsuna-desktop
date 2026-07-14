import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

export type RuntimeEnvironmentResolveInput = {
  projectId?: string;
  threadId: string;
};

export type RuntimeEnvironmentResolver = {
  resolve(input: RuntimeEnvironmentResolveInput): Promise<RuntimeEnvironment>;
};

