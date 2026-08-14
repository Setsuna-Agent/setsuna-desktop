// @vitest-environment happy-dom

import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesSkillDetail } from '../../../../src/features/capabilities/CapabilitiesSkillDetail.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('CapabilitiesSkillDetail', () => {
  it('starts a conversation with the current enabled Skill selected', async () => {
    const onUseInConversation = renderSkillDetail(null);

    await userEvent.click(screen.getByRole('button', { name: '更多操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '在对话中使用' }));

    expect(onUseInConversation).toHaveBeenCalledWith(skill.id);
  });

  it('shows SKILL.md as a preview by default and keeps the source view available', async () => {
    const content = '# Workflow\n\nUse this Skill.';
    renderSkillDetail({
      ...skill,
      content,
      path: '/skills/submit-and-land-pr/SKILL.md',
      references: [],
    });

    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.getByLabelText('SKILL.md 文件内容').textContent).toBe(content);
  });

  it('identifies a Plugin-owned Skill and exposes its edit and delete actions', async () => {
    renderSkillDetail(null, { ...skill, kind: 'plugin', pluginId: 'hello-demo' });

    expect(screen.getByText('插件 Skill')).toBeTruthy();
    expect(screen.queryByText('系统 Skill')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(await screen.findByRole('menuitem', { name: '编辑' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy();
  });
});

function renderSkillDetail(detail: RuntimeSkillDetail | null, summary: RuntimeSkillSummary = skill) {
  const onUseInConversation = vi.fn();
  render(
    <I18nProvider initialLocale="zh-CN">
      <CapabilitiesSkillDetail
        detail={detail}
        error={null}
        loading={false}
        summary={summary}
        onBack={() => undefined}
        onUseInConversation={onUseInConversation}
        onUpdateSkill={async () => undefined}
        onInstallMcpDependencies={async () => undefined}
        onAuthenticateMcpDependency={async () => undefined}
        pendingDependencyKeys={new Set()}
      />
    </I18nProvider>,
  );
  return onUseInConversation;
}

const skill: RuntimeSkillSummary = {
  id: 'submit-and-land-pr',
  name: 'submit-and-land-pr',
  description: 'Publish and land a pull request.',
  kind: 'user',
  enabled: true,
};
