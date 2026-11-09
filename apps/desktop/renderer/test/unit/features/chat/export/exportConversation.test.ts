// @vitest-environment happy-dom
import type {
  DesktopConversationExportInput, DesktopConversationExportResult, RuntimeMessage, RuntimeRequestInput, RuntimeThread,
} from '@setsuna-desktop/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import * as rendererUi from '@setsuna-desktop/renderer-ui';
import { exportConversation } from '../../../../../src/features/chat/export/exportConversation.js';
import { conversationExportHtml } from '../../../../../src/features/chat/export/conversationExportHtml.js';
import { createDesktopRuntimeClient } from '../../../../../src/services/runtime-client/client.js';
import { translate, type Translate } from '../../../../../src/shared/i18n/I18nProvider.js';

const t: Translate = (key, params) => translate('zh-CN', key, params);
const thread: RuntimeThread = {
  id: 'target / 1', title: '导出对话', createdAt: '', updatedAt: '', archived: false,
  messageCount: 0, lastMessagePreview: '', lastSeq: 1, messages: [],
};

function install(snapshot: RuntimeThread) {
  const save = vi.fn(async (_input: DesktopConversationExportInput): Promise<DesktopConversationExportResult> => ({ ok: true }));
  const request = vi.fn(async (input: RuntimeRequestInput) => ({ ok: true, value: {
    ...snapshot, messages: input.path.includes('messageLimit=160') ? snapshot.messages.slice(-160) : snapshot.messages,
  } }));
  vi.stubGlobal('setsunaDesktop', { desktop: { saveConversationExport: save }, runtime: { request } });
  return { client: createDesktopRuntimeClient(), save, request };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['markdown', 'html'] as const)('exports both ends of long histories and excludes model-only content and metadata: %s', async (format) => {
  const messages: RuntimeMessage[] = Array.from({ length: 110 }, (_, index) => [
    { id: `user-${index}`, role: 'user' as const, turnId: `turn-${index}`, content: `question-${index}-end`, createdAt: '' },
    { id: `answer-${index}`, role: 'assistant' as const, turnId: `turn-${index}`, phase: 'final_answer' as const,
      content: `answer-${index}-end`, createdAt: '', providerMetadata: {
        anthropic: { contentBlocks: [{ type: 'thinking' as const, thinking: 'provider-private-marker', signature: 'private-signature' }] },
      } },
  ]).flat();
  messages.unshift(
    { id: 'system', role: 'system', content: 'system-private-marker', createdAt: '' },
    { id: 'hidden', role: 'assistant', visibility: 'model', content: 'model-private-marker', createdAt: '' },
  );
  const { client, save } = install({ ...thread, messages, messageCount: messages.length });
  await exportConversation(client, thread.id, format, t, 'zh-CN');
  const output = save.mock.calls[0][0].content;
  expect(output.indexOf('question-0-end')).toBeGreaterThan(-1);
  expect(output.indexOf('answer-0-end')).toBeGreaterThan(output.indexOf('question-0-end'));
  expect(output.indexOf('question-109-end')).toBeGreaterThan(output.indexOf('answer-0-end'));
  expect(output.indexOf('answer-109-end')).toBeGreaterThan(output.indexOf('question-109-end'));
  expect(output).not.toMatch(/system-private-marker|model-private-marker|provider-private-marker|private-signature/u);
});

it.each(['markdown', 'html'] as const)('retains steering and legacy answers while omitting all execution feedback: %s', async (format) => {
  const { client, save } = install({ ...thread, messages: [
    { id: 'prompt', role: 'user', turnId: 'turn', content: 'original-question', createdAt: '' },
    { id: 'progress', role: 'assistant', turnId: 'turn', phase: 'commentary', content: '<think>private-reasoning</think>visible-progress', createdAt: '',
      toolRuns: [
        { id: 'shell', name: 'exec_command', status: 'success', resultPreview: 'tool-result-marker' },
        { id: 'hidden', name: 'update_plan', status: 'success', resultPreview: 'private-bookkeeping' },
      ] },
    { id: 'steer', role: 'user', turnId: 'turn', content: 'steering-instruction', createdAt: '' },
    { id: 'answer', role: 'assistant', turnId: 'turn', content: 'legacy-answer', createdAt: '', toolRuns: [
      { id: 'final-tool', name: 'exec_command', status: 'error', resultPreview: 'final-tool-marker' },
    ] },
  ] });
  await exportConversation(client, thread.id, format, t, 'zh-CN');
  const output = save.mock.calls[0][0].content;
  expect(output).toContain('original-question');
  expect(output.split('steering-instruction')).toHaveLength(2);
  expect(output).toContain('legacy-answer');
  expect(output).not.toMatch(/visible-progress|exec_command|tool-result-marker|final-tool-marker|private-reasoning|private-bookkeeping/u);
});

it('embeds rendered Mermaid images for offline use and preserves source when one diagram fails', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><text x="10" y="20">offline diagram</text></svg>';
  // Layout belongs to the shared browser renderer, whose parser/security have separate coverage.
  const render = vi.spyOn(rendererUi, 'renderMermaidDiagram')
    .mockResolvedValueOnce(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    .mockRejectedValueOnce(new Error('Invalid diagram'))
    .mockResolvedValueOnce(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const valid = 'flowchart LR\n  A[Input] --> B[Result]';
  const invalid = 'flowchart LR\nA[unfinished';
  const sequence = 'sequenceDiagram\n  Alice->>Bob: Message';
  const { client, save } = install({ ...thread, messages: [
    { id: 'answer', role: 'assistant', content: [valid, invalid, sequence].map((code) => `\`\`\`mermaid\n${code}\n\`\`\``).join('\n\n'), createdAt: '' },
  ] });
  await exportConversation(client, thread.id, 'html', t, 'zh-CN');
  expect(render.mock.calls.map(([code]) => code.trim())).toEqual([valid, invalid, sequence]);
  const document = new DOMParser().parseFromString(save.mock.calls[0][0].content, 'text/html');
  const images = [...document.querySelectorAll('figure img')];
  expect(images).toHaveLength(2);
  for (const image of images) {
    const source = image.getAttribute('src') ?? '';
    expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    const svg = new DOMParser().parseFromString(decodeURIComponent(source.slice(source.indexOf(',') + 1)), 'image/svg+xml');
    expect(svg.documentElement.localName).toBe('svg');
    expect(svg.querySelector('text')?.textContent).toBe('offline diagram');
  }
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('code.language-mermaid')?.textContent).toContain(invalid);
});

it('exports HTML as inert content even when titles, links, attachments and messages contain active payloads', async () => {
  const title = '</title><script>alert("title")</script>';
  const { client, save } = install({ ...thread, title, messages: [
    { id: 'prompt', role: 'user', content: '[unsafe](javascript:alert(1))\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>', createdAt: '',
      attachments: [{ id: 'attachment', name: '[payload](javascript:alert(1))', size: 0, type: 'text/plain', url: 'javascript:alert(1)' }] },
    { id: 'answer', role: 'assistant', content: '```html\n<script>alert("example")</script>\n```', createdAt: '' },
  ] });
  await exportConversation(client, thread.id, 'html', t, 'zh-CN');
  const document = new DOMParser().parseFromString(save.mock.calls[0][0].content, 'text/html');
  expect(document.title).toBe(title);
  expect(document.querySelector('script, iframe, object, embed, [onerror]')).toBeNull();
  expect(document.querySelector('a[href^="javascript:"], img[src^="javascript:"]')).toBeNull();
  expect(document.querySelector('code')?.textContent).toContain('<script>alert("example")</script>');
});

it('treats save cancellation as normal and propagates write failures to the caller', async () => {
  const { client, save } = install(thread);
  save.mockResolvedValueOnce({ ok: true, cancelled: true });
  await expect(exportConversation(client, thread.id, 'markdown', t, 'zh-CN')).resolves.toBeUndefined();
  save.mockResolvedValueOnce({ ok: false, error: 'Disk is full' });
  await expect(exportConversation(client, thread.id, 'markdown', t, 'zh-CN')).rejects.toThrow('Disk is full');
});

it.each(['1', '来源'])('keeps footnotes and backreferences within their own message: %s', async (label) => {
  const html = await conversationExportHtml({ title: 'Sources', entries: [
    { role: 'assistant', heading: 'First', content: `First claim[^${label}]\n\n[^${label}]: Origin A` },
    { role: 'assistant', heading: 'Second', content: `Second claim[^${label}]\n\n[^${label}]: Origin B` },
  ] }, 'zh-CN');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const references = [...document.querySelectorAll('a[data-footnote-ref]')];
  expect(references).toHaveLength(2);
  const targets = references.map((reference) => document.getElementById(decodeURIComponent(reference.getAttribute('href')!.slice(1)))!);
  expect(targets[0].textContent).toContain('Origin A');
  expect(targets[1].textContent).toContain('Origin B');
  const descriptions = references.map((reference) => document.getElementById(reference.getAttribute('aria-describedby')!));
  expect(descriptions[0]).not.toBeNull();
  expect(descriptions[1]).not.toBeNull();
  expect(descriptions[0]).not.toBe(descriptions[1]);
  targets.forEach((target, index) => {
    const backlink = target.querySelector('a[data-footnote-backref]')!;
    expect(document.getElementById(decodeURIComponent(backlink.getAttribute('href')!.slice(1)))).toBe(references[index]);
  });
});
