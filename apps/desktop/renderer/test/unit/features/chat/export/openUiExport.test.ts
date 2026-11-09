// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { conversationExportHtml } from '../../../../../src/features/chat/export/conversationExportHtml.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function exportProgram(program: string, role: 'assistant' | 'user' = 'assistant'): Promise<Document> {
  const html = await conversationExportHtml({ title: 'Export', entries: [{ role, heading: role,
    content: `Before\n\n\`\`\`openui\n${program}\n\`\`\`\n\nAfter` }] }, 'zh-CN');
  return new DOMParser().parseFromString(html, 'text/html');
}

it('exports initialized data, every table row and every tab without retaining a live renderer', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const rows = [{ name: 'excluded', value: -100 }, ...Array.from({ length: 25 }, (_, index) => ({ name: `record-${index}`, value: index }))];
  const program = [
    'root = Stack([Tabs([TabItem("rows", "Records", [table]), TabItem("total", "Total", [TextContent("Total: " + @Sum(filtered.value))])])])',
    '$query = "record"',
    `rows = ${JSON.stringify(rows)}`,
    'filtered = @Filter(rows, "name", "contains", $query)',
    'table = Table([Col("Name", filtered.name), Col("Value", filtered.value)])',
  ].join('\n');
  const document = await exportProgram(program);
  const cells = [...document.querySelectorAll('tbody tr')].map((row) => row.textContent);
  expect(cells).toHaveLength(25);
  expect(cells[0]).toBe('record-00');
  expect(cells.at(-1)).toBe('record-2424');
  expect(document.body.textContent).toContain('Total: 300');
  expect(document.body.textContent).not.toContain('excluded');
  expect(document.querySelector('script, code.language-openui')).toBeNull();
  expect(globalThis.document.querySelector('.conversation-openui')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('captures the rendered SVG charts instead of empty client-only containers', async () => {
  // Supply browser measurement/canvas capabilities; keep the real chart and OpenUI renderers.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '14px sans-serif', measureText: (text: string) => ({ width: text.length * 7 }),
  } as CanvasRenderingContext2D);
  const document = await exportProgram('root = Stack([BarChart(["Mon", "Tue"], [Series("Sales", [12, 25])]), PieChart(["Alpha", "Beta"], [30, 70])])');
  const snapshot = document.querySelector('.conversation-openui');
  expect(snapshot).not.toBeNull();
  expect(snapshot!.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  expect(snapshot!.querySelectorAll('svg path, svg rect').length).toBeGreaterThan(0);
  expect(snapshot!.textContent).toContain('Mon');
  expect(snapshot!.textContent).toContain('Alpha');
  expect(document.querySelector('code.language-openui')).toBeNull();
  for (const node of snapshot!.querySelectorAll('svg [clip-path]')) {
    const id = node.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/u)?.[1];
    if (id) expect(document.getElementById(id)).not.toBeNull();
  }
});

it('isolates footnotes between OpenUI text components and across exported messages', async () => {
  const entries = ['A', 'B'].map((message) => {
    const widgets = ['first', 'second'].map((part) =>
      `TextContent(${JSON.stringify(`Claim[^1]\n\n[^1]: ${message}-${part}`)})`);
    const program = `root = Stack([${widgets.join(', ')}])`;
    return { role: 'assistant' as const, heading: message,
      content: `Outer[^1]\n\n[^1]: outer-${message}\n\n\`\`\`openui\n${program}\n\`\`\`` };
  });
  const exported = new DOMParser().parseFromString(await conversationExportHtml({ title: 'Sources', entries }, 'zh-CN'), 'text/html');
  const references = [...exported.querySelectorAll('a[data-footnote-ref]')];
  expect(references).toHaveLength(6);
  const sources = ['outer-A', 'A-first', 'A-second', 'outer-B', 'B-first', 'B-second'];
  references.forEach((reference, index) => {
    const target = exported.getElementById(decodeURIComponent(reference.getAttribute('href')!.slice(1)))!;
    expect(target.textContent).toContain(sources[index]);
    const backlink = target.querySelector('a[data-footnote-backref]')!;
    expect(exported.getElementById(decodeURIComponent(backlink.getAttribute('href')!.slice(1)))).toBe(reference);
  });
});

it('exports open modal contents in place without opening a dialog or stealing focus', async () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  const onFocus = vi.fn();
  document.addEventListener('focusin', onFocus);
  try {
    const exported = await exportProgram([
      'root = Stack([Modal("Details", $opened, [TextContent("Modal total: " + @Sum(values))]), Modal("Closed", false, [TextContent("hidden-modal-body")])])',
      '$opened = true',
      'values = [12, 25]',
    ].join('\n'));
    expect(exported.body.textContent).toContain('Modal total: 37');
    expect(exported.body.textContent).not.toContain('hidden-modal-body');
    expect(exported.querySelector('code.language-openui')).toBeNull();
    expect(onFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  } finally {
    document.removeEventListener('focusin', onFocus);
    trigger.remove();
  }
});

it.each([
  'root = Stack([TextContent(data.value)])\ndata = Query("remote", {})',
  'root = Stack([Button("submit", @Run(save))])\nsave = Mutation("save", {})',
])('retains unsupported source without invoking remote or host actions', async (program) => {
  const fetch = vi.fn();
  const open = vi.spyOn(window, 'open');
  vi.stubGlobal('fetch', fetch);
  const document = await exportProgram(program);
  expect(document.querySelector('code.language-openui')?.textContent).toBe(program);
  expect(document.querySelector('.conversation-openui, script')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('keeps user-provided OpenUI examples inert', async () => {
  const document = await exportProgram('root = Stack([TextContent("example")])', 'user');
  expect(document.querySelector('.conversation-openui')).toBeNull();
  expect(document.querySelector('code.language-openui')?.textContent).toContain('root = Stack');
});
