import type { AssistantSidebarTarget } from '../contracts/index.js';

export type AssistantSidebarEntry = AssistantSidebarTarget & {
  title: string;
  pinned?: boolean;
  canDelete: boolean;
};

export type AssistantSidebarActions = {
  onRename(entry: AssistantSidebarEntry): void;
  onTogglePin(entry: AssistantSidebarEntry): void;
  onDelete(entry: AssistantSidebarEntry): void;
};
