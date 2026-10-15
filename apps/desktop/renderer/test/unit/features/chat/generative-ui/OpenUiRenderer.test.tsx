// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from '../../../../../src/features/chat/generative-ui/OpenUiRenderer.js';
import { MarkdownRenderer } from '../../../../../src/features/chat/markdown/MarkdownRenderer.js';

vi.mock('../../../../../src/features/chat/markdown/MarkdownCodeBlock.js', () => ({
  MarkdownCodeBlock: ({ code }: { code: string }) => <pre data-testid="source-fallback">{code}</pre>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const filterProgram = [
  'root = Stack([search, toggle, result])',
  '$query = ""',
  '$mode = "table"',
  'search = Input("search", "搜索项目", "text", null, $query)',
  'toggle = Button("切换", @Set($mode, $mode == "table" ? "text" : "table"))',
  'rows = [{name: "Alpha", value: 12}, {name: "Beta", value: 25}]',
  'filtered = @Filter(rows, "name", "contains", $query)',
  'table = Table([Col("项目", filtered.name), Col("数量", filtered.value, "number")])',
  'result = $mode == "table" ? table : TextContent("详情")',
].join('\n');

describe('display-only OpenUI renderer', () => {
  it.each(['Input', 'TextArea'])('focuses and edits only the labelled %s in its own block', async (control) => {
    const user = userEvent.setup();
    const code = [
      'root = Stack([FormControl("Search", search), result])',
      '$query = ""',
      `search = ${control}("query", "搜索项目", ${control === 'Input' ? '"text"' : '3'}, null, $query)`,
      'rows = [{name: "Alpha"}, {name: "Beta"}]',
      'filtered = @Filter(rows, "name", "contains", $query)',
      'result = Table([Col("项目", filtered.name)])',
    ].join('\n');
    const content = (source: string) => <>
      <section aria-label="first"><OpenUiRenderer code={source} streaming={false} /></section>
      <section aria-label="second"><OpenUiRenderer code={source} streaming={false} /></section>
    </>;
    const view = render(content(code));
    const first = within(view.getByRole('region', { name: 'first' }));
    const second = within(view.getByRole('region', { name: 'second' }));
    const input = second.getByRole('textbox', { name: 'Search' });
    await user.click(second.getByText('Search'));
    expect(document.activeElement).toBe(input);
    await user.keyboard('Beta');
    await waitFor(() => expect(second.queryByText('Alpha')).toBeNull());
    expect(first.getByText('Alpha')).toBeTruthy();
    expect(second.getByRole('cell', { name: 'Beta' })).toBeTruthy();
    view.rerender(content(`${code}\nfooter = TextContent("more")`));
    await user.click(first.getByText('Search'));
    expect(document.activeElement).toBe(first.getByRole('textbox', { name: 'Search' }));
    expect((input as HTMLInputElement).value).toBe('Beta');
  });

  it('filters and switches locally, retaining user state when more source arrives', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const view = render(<OpenUiRenderer code={filterProgram} streaming={false} />);
    await view.findByText('Alpha');
    fireEvent.change(view.getByPlaceholderText('搜索项目'), { target: { value: 'Beta' } });
    await waitFor(() => expect(view.queryByText('Alpha')).toBeNull());
    expect(view.getByText('Beta')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '切换' }));
    await view.findByText('详情');
    view.rerender(<OpenUiRenderer code={`${filterProgram}\nfooter = TextContent("后续内容")`} streaming={false} />);
    expect(view.getByText('详情')).toBeTruthy();
    expect((view.getByPlaceholderText('搜索项目') as HTMLInputElement).value).toBe('Beta');
    fireEvent.click(view.getByRole('button', { name: '切换' }));
    expect(view.getByText('Beta')).toBeTruthy();
    expect(view.queryByText('Alpha')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders a partial stream and enables controls after completion', async () => {
    const view = render(<OpenUiRenderer code='root = Stack([TextContent("逐步' streaming />);
    await view.findByText('逐步');
    view.rerender(<OpenUiRenderer code={filterProgram} streaming />);
    expect((view.getByRole('button', { name: '切换' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<OpenUiRenderer code={filterProgram} streaming={false} />);
    await waitFor(() => expect((view.getByRole('button', { name: '切换' }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.queryByTestId('source-fallback')).toBeNull();
  });

  it.each([
    'root = Stack([MissingWidget("broken")])',
    'root = Stack([TextContent("unfinished',
    'root = Stack([unknown])',
    'root = Stack([TextContent(data.value)])\ndata = Query("remote", {})',
    'root = Stack([Button("submit", @Run(save))])\nsave = Mutation("save", {})',
  ])('falls back for invalid or unsupported programs without calling host capabilities: %s', async (code) => {
    const fetch = vi.fn();
    const open = vi.spyOn(window, 'open');
    vi.stubGlobal('fetch', fetch);
    const view = render(<OpenUiRenderer code={code} streaming={false} />);
    expect((await view.findByTestId('source-fallback')).textContent).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not execute remote actions even when model output requests them', async () => {
    const fetch = vi.fn();
    const open = vi.spyOn(window, 'open');
    vi.stubGlobal('fetch', fetch);
    const code = 'root = Stack([Button("external", @OpenUrl("https://example.com")), Button("agent", @ToAssistant("do work"))])';
    const view = render(<OpenUiRenderer code={code} streaming={false} />);
    fireEvent.click(await view.findByRole('button', { name: 'external' }));
    fireEvent.click(view.getByRole('button', { name: 'agent' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains render failures after parsing and recovers on new source (streaming=%s)', async (streaming) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = 'root = Stack([Chips("x", "single", [null])])';
    const view = render(<OpenUiRenderer code={code} streaming={streaming} />);
    view.rerender(<OpenUiRenderer code={code} streaming={false} />);
    expect((await view.findByTestId('source-fallback')).textContent).toBe(code);
    view.rerender(<OpenUiRenderer code={filterProgram} streaming={false} />);
    await view.findByText('Alpha');
    expect(view.queryByTestId('source-fallback')).toBeNull();
    fireEvent.change(view.getByPlaceholderText('搜索项目'), { target: { value: 'Beta' } });
    await waitFor(() => expect(view.queryByText('Alpha')).toBeNull());
  });

  it.each([0, 1, 2, 3])('keeps completed block controls usable and isolated while the surrounding reply streams (indent=%i)', async (indent) => {
    const spaces = ' '.repeat(indent);
    const message = ['Before', `${spaces}\`\`\`openui`, filterProgram, `${spaces}\`\`\``,
      'Between', `${spaces}~~~openui-lang`, filterProgram, `${spaces}~~~`].join('\n\n').replace(/\n/g, '\r\n');
    const view = render(<MarkdownRenderer allowOpenUi content={message} streaming />);
    await waitFor(() => expect(view.getAllByPlaceholderText('搜索项目')).toHaveLength(2));
    const [first, second] = view.getAllByPlaceholderText('搜索项目') as HTMLInputElement[];
    expect(first.disabled).toBe(false);
    fireEvent.change(first, { target: { value: 'Beta' } });
    view.rerender(<MarkdownRenderer allowOpenUi content={`${message}\n\nAfter`} streaming={false} />);
    expect(view.getByText('After')).toBeTruthy();
    expect(view.getAllByPlaceholderText('搜索项目')[0]).toBe(first);
    expect(first.value).toBe('Beta');
    expect(second.value).toBe('');
    expect(view.getAllByText('Alpha')).toHaveLength(1);
  });

  it('leaves code examples inert unless the caller explicitly enables assistant display blocks', async () => {
    const code = ['```openui', filterProgram, '```'].join('\n');
    const view = render(<MarkdownRenderer content={code} streaming={false} />);
    expect(view.queryByPlaceholderText('搜索项目')).toBeNull();
    expect(view.getByTestId('source-fallback').textContent).toContain(filterProgram);
    view.rerender(<MarkdownRenderer allowOpenUi content={`<think>${code}</think>\nVisible`} streaming={false} />);
    expect(view.queryByPlaceholderText('搜索项目')).toBeNull();
    expect(view.getByText('Visible')).toBeTruthy();
  });

  it('resolves document references and footnotes across blocks without resetting local state', async () => {
    const message = ['[来源][ref]，脚注[^note]。', '```openui', filterProgram, '```',
      '[ref][] 和 [ref]，再次引用[^note]。', '```openui', 'root = Stack([TextContent("第二块")])', '```'].join('\n\n');
    const view = render(<MarkdownRenderer allowOpenUi content={message} streaming />);
    const input = await view.findByPlaceholderText('搜索项目') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Beta' } });
    view.rerender(<MarkdownRenderer allowOpenUi streaming={false} content={`${message}\n\n[ref]: https://example.com/report\n\n[^note]: 共享的脚注 [ref]。`} />);
    expect(view.getByRole('link', { name: '来源' }).getAttribute('href')).toBe('https://example.com/report');
    expect(view.getAllByRole('link', { name: 'ref' })).toHaveLength(3);
    const references = view.container.querySelectorAll('a[data-footnote-ref]');
    expect(references).toHaveLength(2);
    const target = references[0].getAttribute('href')!.slice(1);
    expect(references[1].getAttribute('href')).toBe(`#${target}`);
    expect(view.container.querySelectorAll(`[id="${target}"]`)).toHaveLength(1);
    for (const backlink of view.container.querySelectorAll('a[data-footnote-backref]')) {
      expect(view.container.querySelector(`[id="${backlink.getAttribute('href')!.slice(1)}"]`)).toBeTruthy();
    }
    expect(view.getByPlaceholderText('搜索项目')).toBe(input);
    expect(input.value).toBe('Beta');
    expect(view.queryByText('Alpha')).toBeNull();
  });
});
