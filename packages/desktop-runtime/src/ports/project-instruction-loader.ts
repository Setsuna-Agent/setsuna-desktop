import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

export type ProjectInstructionSource = {
  content: string;
  directory: string;
  path: string;
  truncated: boolean;
};

export type ProjectInstructionLoadInput = {
  environment: RuntimeEnvironment;
  maxBytes?: number;
  fallbackFilenames?: string[];
};

export type ProjectInstructionLoader = {
  load(input: ProjectInstructionLoadInput): Promise<ProjectInstructionSource[]>;
};
