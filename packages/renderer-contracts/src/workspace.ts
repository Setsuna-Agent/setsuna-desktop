import { defineKeyedRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ReactNode } from 'react';

/** Shared by panel state and host registration so every panel type has an outlet. */
export const RENDERER_WORKSPACE_PANEL_TYPES = Object.freeze([
  'overview',
  'browser',
  'chat',
  'subagent',
  'conversation-debug',
  'files',
  'file',
  'review',
  'changes',
  'commit-message',
  'terminal',
] as const);

export type RendererWorkspacePanelType = typeof RENDERER_WORKSPACE_PANEL_TYPES[number];

export type RendererWorkspacePanelPlacement = 'bottom' | 'side';

export type WorkspacePanelSlotProps = Readonly<{
  panelId: string;
  panelType: RendererWorkspacePanelType;
  placement: RendererWorkspacePanelPlacement;
  projectId: string | null;
  surfaceInstanceId: string;
  threadId: string | null;
  translate: RendererTranslate;
  visible: boolean;
  renderDefault(): ReactNode;
}>;

/** Resolves a panel type to a renderer while panel session/layout state stays host-owned. */
export const workspacePanelSlot = defineKeyedRendererSlot<
  RendererWorkspacePanelType,
  WorkspacePanelSlotProps
>({
  id: 'renderer.workspace.panel',
  scope: 'thread',
  userConfigurable: true,
});
