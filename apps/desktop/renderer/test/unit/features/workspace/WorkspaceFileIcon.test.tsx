import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceFileIcon } from '../../../../src/features/workspace/WorkspaceFileIcon.js';

describe('WorkspaceFileIcon', () => {
  it('renders distinct Seti assets and palette classes for different file types', () => {
    const codeHtml = renderToStaticMarkup(<WorkspaceFileIcon path="src/App.tsx" type="file" />);
    const packageHtml = renderToStaticMarkup(<WorkspaceFileIcon path="package.json" type="file" />);

    expect(codeHtml).toContain('data-file-icon-theme="seti"');
    expect(codeHtml).toContain('<svg');
    expect(codeHtml).toContain('data-file-icon-color="blue"');
    expect(packageHtml).toContain('data-file-icon-color="yellow"');
    expect(codeHtml).not.toBe(packageHtml);
  });

  it('does not render an icon for directories', () => {
    const html = renderToStaticMarkup(<WorkspaceFileIcon path="src" type="directory" />);

    expect(html).toBe('');
  });
});
