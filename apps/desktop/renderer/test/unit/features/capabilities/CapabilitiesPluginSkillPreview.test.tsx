// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesPluginDetail } from '../../../../src/features/capabilities/CapabilitiesPluginDetail.js';

describe('CapabilitiesPluginDetail Skill preview', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('previews the active runtime content for an edited Plugin Skill', async () => {
    const runtimeSkill = {
      id: 'docs-plugin.active',
      name: 'Customized Skill',
      kind: 'plugin' as const,
      pluginId: 'docs-plugin',
      enabled: true,
      content: '# Customized runtime workflow',
      references: [],
    };
    const onGetItemContent = vi.fn(async () => ({
      pluginId: 'docs-plugin',
      itemId: 'docs-plugin.active',
      kind: 'skill' as const,
      files: [{
        path: 'skills/active/SKILL.md',
        mimeType: 'text/markdown',
        size: 18,
        text: '# Bundled workflow',
      }],
    }));
    const onGetSkillDetail = vi.fn(async () => runtimeSkill);
    const user = userEvent.setup();
    render(
      <CapabilitiesPluginDetail
        error={null}
        installedPlugin={{
          id: 'docs-plugin',
          name: 'Docs Plugin',
          installedAt: '2026-08-14T00:00:00.000Z',
          skills: [{ id: runtimeSkill.id, name: runtimeSkill.name }],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        runtimeSkills={[runtimeSkill]}
        installing={false}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onGetItemContent={onGetItemContent}
        onGetSkillDetail={onGetSkillDetail}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Customized Skill/u }));
    expect(await screen.findByRole('heading', { name: 'Customized runtime workflow' })).toBeTruthy();
    expect(onGetSkillDetail).toHaveBeenCalledWith(runtimeSkill.id);
    expect(onGetItemContent).not.toHaveBeenCalled();
  });
});
