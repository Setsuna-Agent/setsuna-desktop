// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilitiesPluginDetailSection } from '../../../../src/features/capabilities/CapabilitiesPluginDetailSection.js';

describe('CapabilitiesPluginDetailSection', () => {
  afterEach(cleanup);

  it('collapses empty sections by default while keeping them expandable', async () => {
    render(
      <CapabilitiesPluginDetailSection
        count={0}
        empty="这个插件不包含工具。"
        icon={<span />}
        title="工具"
      >
        <span>工具内容</span>
      </CapabilitiesPluginDetailSection>,
    );

    const toggle = screen.getByRole('button', { name: /工具/u });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('这个插件不包含工具。').closest('[hidden]')).not.toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
