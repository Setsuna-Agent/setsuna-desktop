import type { ComponentProps, PointerEvent as ReactPointerEvent } from 'react';
import {
  CollaborationFeatureTaskDirectory,
  useCollaborationFeatureNavigation,
} from '../../composition/CollaborationFeatureBoundary.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopPanelSlot } from '../workspace/model.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { SubagentConversationPanel } from './SubagentConversationPanel.js';

type SubagentPanelProps = Omit<ComponentProps<typeof SubagentConversationPanel>, 'childThreadId' | 'onBack'> & {
  childThreadId: string | null;
  hidden: boolean;
  placement?: DesktopPanelSlot;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
};

/** A parent conversation owns one panel; list/detail navigation never changes agent execution. */
export function SubagentPanel({
  childThreadId, hidden, placement = 'side', onResizeStep, onResizeStart,
  workspaceMaxWidth, workspaceMinWidth, workspaceWidth, ...conversation
}: SubagentPanelProps) {
  const { t } = useI18n();
  const navigation = useCollaborationFeatureNavigation();
  return (
    <aside
      className={`desktop-workspace-panel desktop-subagent-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      aria-label={t(childThreadId ? 'feature.collaboration.panel.label' : 'feature.collaboration.overview.tasks')}
      hidden={hidden}
    >
      {placement === 'side' ? (
        <WorkspaceResizeHandle
          max={workspaceMaxWidth} min={workspaceMinWidth} value={workspaceWidth}
          onResizeStart={onResizeStart} onResizeStep={onResizeStep}
        />
      ) : null}
      {childThreadId ? (
        <SubagentConversationPanel
          {...conversation}
          key={childThreadId}
          childThreadId={childThreadId}
          onBack={() => navigation?.openList(conversation.parentThreadId)}
        />
      ) : (
        <CollaborationFeatureTaskDirectory parentThreadId={conversation.parentThreadId} translate={t} onClose={conversation.onClose} />
      )}
    </aside>
  );
}
