// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMarkdown } from '../src/document-markdown.js';

afterEach(cleanup);

it('removes executable Markdown content and delegates safe links to the host', () => {
  const onOpenLink = vi.fn();
  const view = render(<DocumentMarkdown onOpenLink={onOpenLink} content={[
    '[Guide](https://example.com/guide) [Unsafe](javascript:alert(1))',
    '<script>window.markdownInjected=true</script><iframe src="https://example.com"/>',
    '<a href="https://example.com" onclick="alert(1)">HTML link</a>',
    '<img src="https://example.com/image.png" onerror="alert(1)"/>',
  ].join('\n\n')} />);

  expect(view.container.querySelector('script, iframe, [onclick], [onerror], [href^="javascript:"]')).toBeNull();
  expect(screen.getByText('Unsafe').closest('a')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Guide' }));
  expect(onOpenLink).toHaveBeenCalledExactlyOnceWith('https://example.com/guide');
});
