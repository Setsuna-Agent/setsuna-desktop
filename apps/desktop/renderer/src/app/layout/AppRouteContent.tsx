import type {
  RuntimeConfiguredModelReference,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react';
import type { ChatTurnActions } from '../../features/chat/hooks/useChatTurnActions.js';
import type { SettingsSectionId } from '../../features/settings/settings-types.js';
import type { DesktopWorkspacePanelsState } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import type { RuntimeClientState } from '../../services/runtime-client/useRuntimeClientState.js';
import type {
  ChatSkillSelectionRequest,
  ConversationOverviewVisibility,
  MainView,
} from '../types.js';
import { CapabilitiesRouteAdapter } from './CapabilitiesRouteAdapter.js';
import { ChatRouteAdapter } from './ChatRouteAdapter.js';
import { SettingsRouteAdapter } from './SettingsRouteAdapter.js';

export type AppRouteContentProps = Readonly<{
  activeProject?: WorkspaceProject;
  activeWorkspace?: WorkspaceProject;
  activeView: MainView;
  chatActions: ChatTurnActions;
  composerKey: string;
  conversationOverviewShowRequest: number;
  conversationOverviewVisibility: ConversationOverviewVisibility;
  draft: string;
  focusComposerRequest: number;
  projectWorkspace: ProjectWorkspaceState;
  runtime: RuntimeClientState;
  selectedCapabilitiesPluginId: string | null;
  settingsInitialSection?: SettingsSectionId | null;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setDraft: Dispatch<SetStateAction<string>>;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  startCurrentThreadReview: (
    target: ReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => Promise<unknown>;
  workspacePanels: DesktopWorkspacePanelsState;
  onSelectSkillForChat(skillId: string): void;
  onConversationOverviewRenderedChange(visible: boolean): void;
  onFocusComposerRequestConsumed(requestId: number): void;
  onOpenPlugin(pluginId: string): void;
  onOpenModelSettings(): void;
  onSelectedCapabilitiesPluginIdChange(pluginId: string | null): void;
  onSkillSelectionRequestConsumed(requestId: number): void;
  onTerminalResizeStep(delta: number): void;
  onTerminalResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void;
  terminalHeight: number;
  terminalMaxHeight: number;
  terminalMinHeight: number;
  onWorkspaceResizeStep(delta: number): void;
  onWorkspaceResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}>;

export function AppRouteContent(props: AppRouteContentProps) {
  if (props.activeView === 'settings') return <SettingsRouteAdapter {...props} />;
  if (props.activeView === 'capabilities') return <CapabilitiesRouteAdapter {...props} />;
  return <ChatRouteAdapter {...props} />;
}
