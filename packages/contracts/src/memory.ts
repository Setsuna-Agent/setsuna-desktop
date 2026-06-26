export type RuntimeMemoryScope = 'global' | 'project';

export type RuntimeMemoryRecord = {
  id: string;
  scope: RuntimeMemoryScope;
  projectId?: string;
  content: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeMemoryQuery = {
  scope?: RuntimeMemoryScope;
  projectId?: string;
  search?: string;
  limit?: number;
};

export type CreateRuntimeMemoryInput = {
  scope?: RuntimeMemoryScope;
  projectId?: string;
  content: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
};

export type RuntimeMemoryList = {
  memories: RuntimeMemoryRecord[];
};
