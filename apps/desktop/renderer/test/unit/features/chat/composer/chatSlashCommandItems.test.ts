import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { Translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import {
  createChatSlashCommandItems,
  type ChatSlashCommandItemsOptions,
} from '../../../../../src/features/chat/composer/chatSlashCommandItems.js';

const t = ((key: string) => key) as Translate;

describe('chat slash command items', () => {
  it('retains the action order and contextual disabled states', () => {
    const items = createChatSlashCommandItems(options({
      activeProjectSelected: false,
      activeTurnId: 'turn-1',
      canClearContext: true,
      hasCurrentThread: false,
      sideChatAvailable: false,
    }));

    expect(items.map((item) => item.key)).toEqual([
      'model',
      'plan',
      'collaboration',
      'goal',
      'usage',
      'side-chat',
      'review',
      'compact-context',
      'clear-context',
    ]);
    expect(action(items, 'usage').disabled).toBe(true);
    expect(action(items, 'side-chat').disabled).toBe(true);
    expect(action(items, 'review').disabled).toBe(true);
    expect(action(items, 'compact-context').disabled).toBe(true);
    expect(action(items, 'clear-context').disabled).toBe(true);
  });

  it('filters skills by normalized query, enabled state, and current selection', () => {
    const skills = Array.from({ length: 10 }, (_, index) => skill(index));
    skills[1] = { ...skills[1], enabled: false };

    const items = createChatSlashCommandItems(options({
      query: '  DEPLOY  ',
      selectedSkills: [skills[0]],
      skills,
    }));

    expect(items).toHaveLength(8);
    expect(items.every((item) => item.kind === 'skill')).toBe(true);
    expect(items.map((item) => item.key)).toEqual(
      skills.slice(2).map((item) => `skill:${item.id}`),
    );
  });

  it('keeps enabled Skill slots visible alongside the bare slash quick actions', () => {
    const skills = Array.from({ length: 10 }, (_, index) => skill(index));
    skills[1] = { ...skills[1], enabled: false };

    const items = createChatSlashCommandItems(options({
      selectedSkills: [skills[0]],
      skills,
    }));

    expect(items.slice(0, 9).map((item) => item.key)).toEqual([
      'model',
      'plan',
      'collaboration',
      'goal',
      'usage',
      'side-chat',
      'review',
      'compact-context',
      'clear-context',
    ]);
    expect(items.slice(9).map((item) => item.key)).toEqual(
      skills.slice(2).map((item) => `skill:${item.id}`),
    );
  });

  it('matches quick actions through their translated display text', () => {
    const items = createChatSlashCommandItems(options({ query: 'review' }));

    expect(items.map((item) => item.key)).toEqual(['review']);
  });
});

function options(overrides: Partial<ChatSlashCommandItemsOptions> = {}): ChatSlashCommandItemsOptions {
  return {
    activeGoal: null,
    activeModelName: 'Current model',
    activeProjectSelected: true,
    activeTurnId: null,
    canClearContext: true,
    contextCompactPercent: 42,
    contextCompacting: false,
    goalModeEnabled: false,
    hasCurrentThread: true,
    multiAgentEnabled: false,
    planModeEnabled: false,
    query: '',
    selectedSkills: [],
    sideChatAvailable: true,
    skills: [],
    t,
    ...overrides,
  };
}

function skill(index: number): RuntimeSkillSummary {
  return {
    id: `deploy-${index}`,
    name: `Deploy ${index}`,
    kind: 'user',
    enabled: true,
    selected: false,
    description: 'Deployment workflow',
  };
}

function action(
  items: ReturnType<typeof createChatSlashCommandItems>,
  key: string,
): Extract<ReturnType<typeof createChatSlashCommandItems>[number], { kind: 'action' }> {
  const item = items.find((candidate) => candidate.key === key);
  if (!item || item.kind !== 'action') throw new Error(`Missing action ${key}`);
  return item;
}
