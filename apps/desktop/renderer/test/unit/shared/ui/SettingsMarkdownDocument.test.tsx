// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsMarkdownDocument } from '../../../../src/shared/ui/SettingsMarkdownDocument.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const labels = { name: 'SKILL.md', previewLabel: '预览', sourceLabel: '源码' };

it('previews Skill Markdown and safe HTML by default while keeping the original source intact', () => {
  const content = [
    '---\nname: test-skill\ndescription: Internal metadata\n---',
    '# Workflow',
    'Read **carefully** and run `gh status`.',
    '- [x] Ready\n- [ ] Pending',
    '| Action | Status |\n| --- | --- |\n| Preview | Ready |',
    '```sh\ngh status\n```',
    '<details><summary>More</summary>Additional instructions</details>',
    '<script>alert(1)</script><iframe src="https://example.com"></iframe>',
    '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
  ].join('\n\n');
  const view = render(<SettingsMarkdownDocument {...labels} content={content} />);
  expect(screen.getByRole('heading', { name: 'Workflow', level: 1 })).toBeTruthy();
  expect(screen.getByText('carefully').tagName).toBe('STRONG');
  expect(screen.getByRole('table').textContent).toContain('PreviewReady');
  expect(screen.getAllByRole('checkbox').map((node) => (node as HTMLInputElement).checked)).toEqual([true, false]);
  expect(view.container.querySelector('pre code')?.textContent).toBe('gh status\n');
  expect(view.container.querySelector('details summary')?.textContent).toBe('More');
  expect(view.container.textContent).not.toContain('Internal metadata');
  expect(view.container.querySelector('script, iframe, [onclick]')).toBeNull();
  expect(screen.getByText('Unsafe link').closest('a')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '源码' }));
  expect(view.container.querySelector('pre')?.textContent).toBe(content);
  expect(view.container.querySelector('script, iframe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '预览' }));
  expect(screen.getByRole('heading', { name: 'Workflow', level: 1 })).toBeTruthy();
});

it('opens links only after a click and keeps heading navigation inside the document', () => {
  const openExternal = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('setsunaDesktop', { links: { openExternal } });
  render(<SettingsMarkdownDocument {...labels} content={'[GitHub](https://github.com) [Go](#setup) [Local](file:///tmp/private)\n\n## Setup'} />);
  expect(openExternal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'GitHub' }));
  expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com');
  const heading = screen.getByRole('heading', { name: 'Setup' });
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole('link', { name: 'Go' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  expect(openExternal).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Local').closest('a')).toBeNull();
});
