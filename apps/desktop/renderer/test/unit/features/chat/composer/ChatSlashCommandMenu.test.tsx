// @vitest-environment happy-dom

import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatSlashCommandMenu } from '../../../../../src/features/chat/composer/ChatSlashCommandMenu.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('ChatSlashCommandMenu', () => {
  it('aligns ordinary and Plugin Skill icons with their catalog presentation', () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <ChatSlashCommandMenu
          activeIndex={0}
          items={[
            skillItem({
              id: 'goal-writer',
              name: 'Goal Writer',
              kind: 'builtin',
              enabled: true,
              selected: false,
            }),
            skillItem({
              id: 'openai-vision-recognition.vision-recognition',
              name: '视觉识别',
              kind: 'plugin',
              enabled: true,
              selected: false,
              pluginId: 'openai-vision-recognition',
            }),
          ]}
          onHover={() => undefined}
          onSelect={() => undefined}
        />
      </I18nProvider>,
    );

    expect(document.querySelector('[data-skill-icon="skill"]')?.classList).toContain('desktop-skill-icon--menu');
    expect(document.querySelector('[data-plugin-icon="vision-recognition"]')?.classList).toContain('desktop-plugin-icon--menu');
  });
});

function skillItem(skill: RuntimeSkillSummary) {
  return {
    key: `skill:${skill.id}`,
    kind: 'skill' as const,
    skill,
  };
}
