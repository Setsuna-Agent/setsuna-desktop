export type RuntimeMemoryScope = 'global' | 'project';
export type RuntimeMemoryOrigin = 'active' | 'passive';

export type RuntimeMemoryRecord = {
  id: string;
  scope: RuntimeMemoryScope;
  projectId?: string;
  content: string;
  origin?: RuntimeMemoryOrigin;
  source?: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  title?: string;
  tags?: string[];
  workspaceRoot?: string;
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
  origin?: RuntimeMemoryOrigin;
  source?: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  title?: string;
  tags?: string[];
  workspaceRoot?: string;
};

export type RuntimeMemoryList = {
  memories: RuntimeMemoryRecord[];
};

export type RuntimeMemoryPreviewItem = {
  id: string;
  title: string;
  scope: RuntimeMemoryScope;
  origin: RuntimeMemoryOrigin;
  source?: string;
  projectId?: string;
  workspaceRoot?: string;
  storageRoot?: string;
  createdAt?: string;
  updatedAt: string;
  chars: number;
  preview: string;
  tags?: string[];
};

export type RuntimeMemoryPreview = {
  storagePath: string;
  total: number;
  items: RuntimeMemoryPreviewItem[];
};
