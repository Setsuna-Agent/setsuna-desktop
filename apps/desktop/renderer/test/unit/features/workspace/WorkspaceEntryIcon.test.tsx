import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceEntryIcon } from '../../../../src/features/workspace/WorkspaceEntryIcon.js';

describe('WorkspaceEntryIcon', () => {
  it('uses the bundled Seti icon for files', () => {
    const html = renderToStaticMarkup(<WorkspaceEntryIcon className="entry-icon" path="src/App.tsx" type="file" />);

    expect(html).toContain('class="entry-icon"');
    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('data-file-icon-color="blue"');
  });

  it('keeps the folder icon for directories', () => {
    const html = renderToStaticMarkup(<WorkspaceEntryIcon className="entry-icon" path="src" type="directory" />);

    expect(html).toContain('class="lucide lucide-folder entry-icon"');
    expect(html).not.toContain('data-file-icon-theme="seti"');
  });
});
