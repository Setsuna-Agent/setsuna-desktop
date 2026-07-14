export type ProjectInstructionSource = {
  content: string;
  directory: string;
  path: string;
  truncated: boolean;
};

export type ProjectInstructionLoadInput = {
  projectId?: string;
  cwd: string;
  maxBytes?: number;
  fallbackFilenames?: string[];
};

export type ProjectInstructionLoader = {
  load(input: ProjectInstructionLoadInput): Promise<ProjectInstructionSource[]>;
};
