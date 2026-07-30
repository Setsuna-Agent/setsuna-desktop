import type {
  RuntimeSkillSummary,
  RuntimeThreadGoal,
  RuntimeThreadMemoryMode,
} from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import type { SlashCommandMenuItem } from './ChatSlashCommandMenu.js';

type SlashQuickAction = Exclude<SlashCommandMenuItem, { kind: 'skill' }>;

export type ChatSlashCommandItemsOptions = {
  activeGoal: RuntimeThreadGoal | null;
  activeModelName: string | null;
  activeProjectSelected: boolean;
  activeTurnId: string | null;
  canClearContext: boolean;
  contextCompactPercent: number;
  contextCompacting: boolean;
  goalEnabled: boolean;
  goalModeEnabled: boolean;
  hasCurrentThread: boolean;
  memoryGenerationEnabled: boolean;
  memoryMode: RuntimeThreadMemoryMode;
  multiAgentEnabled: boolean;
  planModeEnabled: boolean;
  query: string;
  selectedSkills: RuntimeSkillSummary[];
  sideChatAvailable: boolean;
  skills: RuntimeSkillSummary[];
  t: Translate;
};

export function createChatSlashCommandItems({
  activeGoal,
  activeModelName,
  activeProjectSelected,
  activeTurnId,
  canClearContext,
  contextCompactPercent,
  contextCompacting,
  goalEnabled,
  goalModeEnabled,
  hasCurrentThread,
  memoryGenerationEnabled,
  memoryMode,
  multiAgentEnabled,
  planModeEnabled,
  query,
  selectedSkills,
  sideChatAvailable,
  skills,
  t,
}: ChatSlashCommandItemsOptions): SlashCommandMenuItem[] {
  const actions: SlashQuickAction[] = [
    {
      key: 'model',
      kind: 'model',
      title: t('chat.composer.model'),
      description: activeModelName ?? t('chat.composer.selectConfiguredModel'),
      scope: t('chat.composer.scope.local'),
    },
    {
      key: 'plan',
      kind: 'action',
      type: 'plan',
      title: t('chat.composer.planMode'),
      description: activeTurnId
        ? planModeEnabled
          ? t('chat.composer.planEnabledNext')
          : t('chat.composer.planEnableNext')
        : planModeEnabled
          ? t('chat.composer.planEnabled')
          : t('chat.composer.planDescription'),
      checked: planModeEnabled,
      scope: activeTurnId
        ? t('chat.composer.scope.nextTurn')
        : planModeEnabled
          ? t('chat.composer.scope.enabled')
          : t('chat.composer.scope.local'),
    },
    {
      key: 'collaboration',
      kind: 'action',
      type: 'collaboration',
      title: t('chat.composer.collaborationMode'),
      description: multiAgentEnabled
        ? t('chat.composer.collaborationEnabled')
        : t('chat.composer.collaborationDescription'),
      checked: multiAgentEnabled,
      scope: multiAgentEnabled
        ? t('chat.composer.scope.enabled')
        : t('chat.composer.scope.local'),
    },
    {
      key: 'goal',
      kind: 'action',
      type: 'goal',
      title: t('chat.composer.goalMode'),
      description: activeGoal
        ? t('chat.composer.goalActive', { objective: activeGoal.objective })
        : activeTurnId
          ? goalModeEnabled
            ? t('chat.composer.goalEnabledNext')
            : t('chat.composer.goalEnableNext')
          : goalModeEnabled
            ? t('chat.composer.goalEnabled')
            : t('chat.composer.goalDescription'),
      checked: goalEnabled,
      scope: activeGoal || (!activeTurnId && goalEnabled)
        ? t('chat.composer.scope.enabled')
        : activeTurnId
          ? t('chat.composer.scope.nextTurn')
          : t('chat.composer.scope.currentThread'),
    },
    {
      key: 'usage',
      kind: 'action',
      type: 'usage',
      title: t('chat.composer.usage'),
      description: hasCurrentThread
        ? t('chat.composer.usageDescription')
        : t('chat.composer.openChatFirst'),
      disabled: !hasCurrentThread,
      scope: t('chat.composer.scope.currentThread'),
    },
    {
      key: 'side-chat',
      kind: 'action',
      type: 'side-chat',
      title: t('chat.composer.sideChat'),
      description: t('chat.composer.sideChatDescription'),
      disabled: !sideChatAvailable,
      scope: t('chat.composer.scope.rightSidebar'),
    },
    {
      key: 'review',
      kind: 'action',
      type: 'review',
      title: t('chat.composer.reviewChanges'),
      description: activeTurnId
        ? t('chat.composer.reviewWait')
        : activeProjectSelected
          ? t('chat.composer.reviewDescription')
          : t('chat.composer.selectProjectFirst'),
      disabled: Boolean(activeTurnId) || !activeProjectSelected,
      scope: t('chat.composer.scope.currentProject'),
    },
    {
      key: 'memory-mode',
      kind: 'action',
      type: 'memory-mode',
      title: t('chat.composer.memory'),
      description: threadMemoryModeDescription(memoryMode, memoryGenerationEnabled, t),
      disabled: !memoryGenerationEnabled,
      checked: memoryGenerationEnabled && memoryMode === 'enabled',
      scope: threadMemoryModeScope(memoryMode, memoryGenerationEnabled, t),
    },
    {
      key: 'compact-context',
      kind: 'action',
      type: 'compact-context',
      title: t('chat.composer.compactContext'),
      description: activeTurnId
        ? t('chat.composer.compactWait')
        : contextCompacting
          ? t('chat.composer.compacting')
          : canClearContext
            ? contextCompactPercent > 0
              ? t('chat.composer.compactDescriptionUsed', { percent: contextCompactPercent })
              : t('chat.composer.compactDescription')
            : t('chat.composer.nothingToCompact'),
      disabled: Boolean(activeTurnId) || !canClearContext || contextCompacting,
      loading: contextCompacting,
      progressPercent: contextCompactPercent,
      scope: t('chat.composer.scope.local'),
    },
    {
      key: 'clear-context',
      kind: 'action',
      type: 'clear-context',
      title: t('chat.composer.clearContext'),
      description: activeTurnId
        ? t('chat.composer.clearWait')
        : canClearContext
          ? t('chat.composer.clearDescription')
          : t('chat.composer.noContext'),
      disabled: Boolean(activeTurnId) || !canClearContext,
      scope: t('chat.composer.scope.local'),
    },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleActions = actions.filter((action) => (
    !normalizedQuery
    || `${action.key} ${action.title} ${action.description ?? ''} ${action.scope ?? ''}`
      .toLowerCase()
      .includes(normalizedQuery)
  ));
  const selectedSkillIds = new Set(selectedSkills.map((skill) => skill.id));
  const visibleSkills = skills
    .filter((skill) => skill.enabled && !selectedSkillIds.has(skill.id))
    .filter((skill) => (
      !normalizedQuery
      || `${skill.name} ${skill.id} ${skill.description ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    ))
    .slice(0, Math.max(0, 8 - visibleActions.length))
    .map<SlashCommandMenuItem>((skill) => ({
      key: `skill:${skill.id}`,
      kind: 'skill',
      skill,
    }));

  return [...visibleActions, ...visibleSkills];
}

export function nextThreadMemoryMode(mode: RuntimeThreadMemoryMode): RuntimeThreadMemoryMode {
  return mode === 'enabled' ? 'disabled' : 'enabled';
}

function threadMemoryModeDescription(
  mode: RuntimeThreadMemoryMode,
  globalGenerationEnabled: boolean,
  t: Translate,
): string {
  if (!globalGenerationEnabled) return t('chat.composer.memoryGlobalOff');
  if (mode === 'polluted') return t('chat.composer.memoryPolluted');
  return mode === 'enabled'
    ? t('chat.composer.memoryEnabled')
    : t('chat.composer.memoryDisabled');
}

function threadMemoryModeScope(
  mode: RuntimeThreadMemoryMode,
  globalGenerationEnabled: boolean,
  t: Translate,
): string {
  if (!globalGenerationEnabled) return t('chat.composer.scope.globalOff');
  return mode === 'enabled'
    ? t('chat.composer.scope.enabled')
    : t('chat.composer.scope.paused');
}
