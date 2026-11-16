import type { ReactNode } from 'react';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';

export type SidebarSearchCategory = 'all' | 'actions' | 'threads' | 'files' | 'text';

export type SidebarSearchAction = {
  id: string;
  title: string;
  keywords?: string;
  icon: ReactNode;
  shortcut?: KeyboardShortcutCommandId;
  run(): void | Promise<unknown>;
};

export type SidebarSearchFileTarget = {
  projectId: string;
  rootId: string;
  path: string;
  line?: number;
};

export type SidebarWorkspaceSearchResult = {
  id: string;
  kind: 'files' | 'text';
  title: string;
  source: string;
  target: SidebarSearchFileTarget;
};
