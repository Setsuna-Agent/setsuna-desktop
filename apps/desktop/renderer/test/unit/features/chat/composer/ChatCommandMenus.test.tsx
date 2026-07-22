import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEntryCommandMenu } from '../../../../../src/features/chat/composer/ChatCommandMenus.js';

vi.mock('../../../../../src/features/chat/composer/useActiveOptionScroll.js', () => ({
  useActiveOptionScroll: () => ({
    activeOptionRef: { current: null },
    scrollContainerRef: { current: null },
  }),
}));

describe('ProjectEntryCommandMenu', () => {
  it('uses bundled file icons while retaining the folder icon', () => {
    const html = renderToStaticMarkup(
      <ProjectEntryCommandMenu
        activeIndex={0}
        entries={[
          { kind: 'file', name: 'package.json', parent: '', path: 'package.json' },
          { kind: 'directory', name: 'src', parent: '', path: 'src' },
        ]}
        hasProject
        loadError=""
        loading={false}
        onHover={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('data-file-icon-color="yellow"');
    expect(html).toContain('lucide-folder');
    expect(html.match(/data-file-icon-theme="seti"/g)).toHaveLength(1);
  });
});
