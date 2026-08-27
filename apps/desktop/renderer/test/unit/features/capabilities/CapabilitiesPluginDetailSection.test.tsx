// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilitiesPluginDetailSection } from '../../../../src/features/capabilities/CapabilitiesPluginDetailSection.js';

describe('CapabilitiesPluginDetailSection', () => {
  afterEach(cleanup);

  it('hides empty sections', () => {
    render(
      <CapabilitiesPluginDetailSection
        count={0}
        icon={<span />}
        title="工具"
      >
        <span>工具内容</span>
      </CapabilitiesPluginDetailSection>,
    );

    expect(screen.queryByRole('button', { name: /工具/u })).toBeNull();
  });
});
