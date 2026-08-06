import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeActivityTabButton } from '../../../../src/features/runtime-activity/RuntimeActivityCenter.js';

describe('RuntimeActivityTabButton', () => {
  it('hides a zero count and keeps non-zero counts visible', () => {
    const emptyHtml = renderToStaticMarkup(
      <RuntimeActivityTabButton
        active
        count={0}
        id="tasks"
        label="运行任务"
        onSelect={vi.fn()}
      />,
    );
    const populatedHtml = renderToStaticMarkup(
      <RuntimeActivityTabButton
        active={false}
        count={2}
        id="services"
        label="后台服务"
        onSelect={vi.fn()}
      />,
    );

    expect(emptyHtml).not.toContain('runtime-activity-tabs__count');
    expect(emptyHtml).not.toContain('>0<');
    expect(populatedHtml).toContain('runtime-activity-tabs__count');
    expect(populatedHtml).toContain('>2<');
  });
});
