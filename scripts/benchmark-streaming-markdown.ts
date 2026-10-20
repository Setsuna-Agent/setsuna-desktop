import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { act, createElement, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Resolve renderer code at execution time without adding it to Electron's TS project.
const streamingModule = '../apps/desktop/renderer/src/features/chat/markdown/streamingMarkdown.js';
const { reconcileMarkdownRenderBlocks } = await import(streamingModule) as {
  reconcileMarkdownRenderBlocks(previous: unknown, source: string, streaming: boolean): {
    state: unknown;
    blocks: Array<{ content: string; mutable: boolean }>;
  };
};
const hookModule = process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2])).href
  : '../apps/desktop/renderer/src/features/chat/markdown/useSmoothedStreamingContent.js';
const { useSmoothedStreamingContent } = await import(hookModule) as {
  useSmoothedStreamingContent(content: string, streaming: boolean): string;
};

// Drive the real hook with a deterministic 60 Hz transport/paint clock, without a browser.
const window = new Window();
let simulatedTime = 0;
let nextFrame = 0;
const frames = new Map<number, (now: number) => void>();
Object.defineProperties(window, {
  requestAnimationFrame: { value: (callback: (now: number) => void) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  } },
  cancelAnimationFrame: { value: (id: number) => { frames.delete(id); } },
});
Object.defineProperties(globalThis, {
  window: { configurable: true, value: window },
  document: { configurable: true, value: window.document },
  navigator: { configurable: true, value: window.navigator },
  performance: { configurable: true, value: { now: () => simulatedTime } },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
const { createRoot } = await import('react-dom/client');

// Synthetic thinking only: exercise a long list that cannot commit a stable block.
// SSR isolates parsing/render work; these numbers do not measure browser layout or FPS.
const line = '- `.form-notice { padding: 8px 12px; border-radius: 8px; font-size: 13px; }` 使用主题变量保持表单样式一致。\n';
const rows = [25, 100, 250];
const updates = 60;
const results = [];
for (const count of rows) {
  let source = line.repeat(count);
  let previous: unknown = null;
  let published = '';
  let publishedStreaming = true;
  const parsing: number[] = [];
  const rendering: number[] = [];

  function Probe({ content, streaming }: { content: string; streaming: boolean }) {
    const visible = useSmoothedStreamingContent(content, streaming);
    useEffect(() => {
      if (visible === published && streaming === publishedStreaming) return;
      measureUpdate(visible, streaming);
      published = visible;
      publishedStreaming = streaming;
    }, [visible, streaming]);
    return null;
  }

  function measureUpdate(content: string, streaming: boolean) {
    const started = performance.now();
    const result = reconcileMarkdownRenderBlocks(previous, content, streaming);
    parsing.push(performance.now() - started);
    previous = result.state;
    const renderStarted = performance.now();
    for (const block of result.blocks) {
      if (streaming && !block.mutable) continue;
      renderToStaticMarkup(createElement(ReactMarkdown, {
        children: block.content,
        rehypePlugins: [rehypeKatex],
        remarkPlugins: [remarkGfm, remarkMath],
        skipHtml: true,
      }));
    }
    rendering.push(performance.now() - renderStarted);
  }

  const container = window.document.createElement('div');
  const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
  await act(() => root.render(createElement(Probe, { content: source, streaming: true })));
  parsing.length = 0;
  rendering.length = 0;
  for (let index = 0; index < updates; index += 1) {
    source += index % 12 === 0 ? '\n- 继续分析样式：' : '变量';
    await act(() => root.render(createElement(Probe, { content: source, streaming: true })));
    simulatedTime += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    await act(() => pending.forEach((callback) => callback(simulatedTime)));
  }
  const streamedCommits = parsing.length;
  await act(() => root.render(createElement(Probe, { content: source, streaming: false })));
  if (published !== source) throw new Error('Completion lost streamed text.');
  await act(() => root.unmount());
  if (frames.size) throw new Error('Unmount left streaming work queued.');
  results.push({
    characters: source.length,
    sourceUpdates: updates,
    streamedCommits,
    parsing: summarize(parsing),
    markdownRendering: summarize(rendering),
  });
}
await window.happyDOM.close();
console.log(JSON.stringify(results, null, 2));

function summarize(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    totalMs: round(samples.reduce((total, sample) => total + sample, 0)),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]!),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]!),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
