import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeActivityTrigger } from '../../../../src/features/runtime-activity/RuntimeActivityTrigger.js';

describe('RuntimeActivityTrigger', () => {
  it('keeps the running count in the accessible label without rendering a badge', () => {
    const html = renderToStaticMarkup(
      <RuntimeActivityTrigger
        open={false}
        runningTaskCount={12}
        triggerRef={createRef<HTMLButtonElement>()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="打开运行中心，12 个任务正在运行"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('app-topbar-runtime-activity__count');
    expect(html).not.toContain('>12<');
  });
});
