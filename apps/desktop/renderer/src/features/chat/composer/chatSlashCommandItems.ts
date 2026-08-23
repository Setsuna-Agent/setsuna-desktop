import type {
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import type { SlashCommandMenuItem } from './ChatSlashCommandMenu.js';

type SlashQuickAction = Exclude<SlashCommandMenuItem, { kind: 'skill' }>;

const MAX_VISIBLE_SKILLS = 8;

export type ChatSlashCommandItemsOptions = {
  activeModelName: string | null;
  activeProjectSelected: boolean;
  activeTurnId: string | null;
  canClearContext: boolean;
  contextCompactPercent: number;
  contextCompacting: boolean;
  goalModeEnabled: boolean;
  hasReviewIncompatibleContent: boolean;
  multiAgentEnabled: boolean;
  query: string;
  selectedSkills: RuntimeSkillSummary[];
  sideChatAvailable: boolean;
  sideConversation?: boolean;
  skills: RuntimeSkillSummary[];
  t: Translate;
};

export function createChatSlashCommandItems({
  activeModelName,
  activeProjectSelected,
  activeTurnId,
  canClearContext,
  contextCompactPercent,
  contextCompacting,
  goalModeEnabled,
  hasReviewIncompatibleContent,
  multiAgentEnabled,
  query,
  selectedSkills,
  sideChatAvailable,
  sideConversation = false,
  skills,
  t,
}: ChatSlashCommandItemsOptions): SlashCommandMenuItem[] {
  const actions: SlashQuickAction[] = [
    {
      key: 'model',
      kind: 'model',
      title: t('chat.composer.model'),
      description: activeModelName ?? t('chat.composer.selectConfiguredModel'),
    },
    {
      key: 'collaboration',
      kind: 'action',
      type: 'collaboration',
      title: t('chat.composer.collaborationMode'),
      description: multiAgentEnabled
        ? t('chat.composer.collaborationEnabled')
        : t('chat.composer.collaborationDescription'),
    },
    {
      key: 'goal',
      kind: 'action',
      type: 'goal',
      title: t('chat.composer.goalMode'),
      description: activeTurnId
          ? goalModeEnabled
            ? t('chat.composer.goalEnabledNext')
            : t('chat.composer.goalEnableNext')
          : goalModeEnabled
            ? t('chat.composer.goalEnabled')
            : t('chat.composer.goalDescription'),
    },
    {
      key: 'side-chat',
      kind: 'action',
      type: 'side-chat',
      title: t('chat.composer.sideChat'),
      description: t('chat.composer.sideChatDescription'),
      disabled: !sideChatAvailable,
    },
    {
      key: 'review',
      kind: 'action',
      type: 'review',
      title: t('chat.composer.reviewChanges'),
      description: activeTurnId
        ? t('chat.composer.reviewWait')
        : hasReviewIncompatibleContent
          ? t('chat.composer.reviewClearExtras')
        : activeProjectSelected
          ? t('chat.composer.reviewDescription')
          : t('chat.composer.selectProjectFirst'),
      disabled: Boolean(activeTurnId) || !activeProjectSelected || hasReviewIncompatibleContent,
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
    },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleActions = actions
    .filter((action) => !sideConversation || !SIDE_CONVERSATION_HIDDEN_ACTIONS.has(action.key))
    .filter((action) => (
      !normalizedQuery
      || `${action.key} ${action.title} ${action.description ?? ''}`
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
    .slice(0, MAX_VISIBLE_SKILLS)
    .map<SlashCommandMenuItem>((skill) => ({
      key: `skill:${skill.id}`,
      kind: 'skill',
      skill,
    }));

  return [...visibleActions, ...visibleSkills];
}

const SIDE_CONVERSATION_HIDDEN_ACTIONS = new Set([
  'collaboration',
  'goal',
  'side-chat',
  'review',
  'compact-context',
  'clear-context',
]);
