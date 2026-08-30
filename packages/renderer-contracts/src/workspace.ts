import { defineKeyedRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ReactNode } from 'react';

export type RendererWorkspacePanelType =
  | 'overview'
  | 'browser'
  | 'chat'
  | 'subagent'
  | 'conversation-debug'
  | 'files'
  | 'file'
  | 'review'
  | 'terminal';

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
