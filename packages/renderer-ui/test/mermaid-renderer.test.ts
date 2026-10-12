// @vitest-environment happy-dom

import mermaid, { type MermaidConfig } from 'mermaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMermaidDiagram } from '../src/mermaid-renderer.js';

let parsedType: string;
let parsedConfig: MermaidConfig;

beforeEach(() => {
  // Use the real syntax/configuration parser; happy-dom cannot run Mermaid's SVG layout/sanitizer.
  vi.spyOn(mermaid, 'render').mockImplementation(async (_id, code, container) => {
    container?.appendChild(document.createElement('div'));
    const result = await mermaid.parse(code);
    parsedType = result.diagramType;
    parsedConfig = mermaid.mermaidAPI.getConfig();
    return { diagramType: parsedType, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>' };
  });
});
afterEach(() => vi.restoreAllMocks());

const example = `flowchart LR
  A[完整源码快照与审批] --> B[staged Plugin]
  B --> C[项目副本与默认 SDK]
  C --> D[pnpm 安装]
  D --> T[独立进程检查 TypeScript]
  T --> E[独立进程运行 Vite]
  E --> F[绑定产物哈希并提交索引]
  F --> G[打开时校验与读取缓存]
  G --> H[现有隔离页面及数据桥]`;

describe('Mermaid rendering boundary', () => {
  it('recovers from malformed input and renders the next queued flowchart without leaking temporary nodes', async () => {
    const signal = new AbortController().signal;
    const before = Array.from(document.body.children);
    const invalid = renderMermaidDiagram('flowchart LR\nA[unfinished', 'light', signal);
    const valid = renderMermaidDiagram(example, 'light', signal);
    await expect(invalid).rejects.toThrow();
    expect(await valid).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(parsedType).toMatch(/^flowchart/);
    expect(Array.from(document.body.children)).toEqual(before);
  });

  it('prevents frontmatter and directives from relaxing the rendering security policy', async () => {
    const configurations = [`---
config:
  securityLevel: loose
  htmlLabels: true
  themeCSS: 'body { display: none; }'
  secure: []
---`, `%%{init: {"securityLevel":"loose","htmlLabels":true,"themeCSS":"body { display: none; }","secure":[]}}%%`];
    for (const config of configurations) {
      await renderMermaidDiagram(`${config}\n${example}`, 'dark', new AbortController().signal);
      expect(parsedConfig.securityLevel).toBe('strict');
      expect(parsedConfig.htmlLabels).toBe(false);
      expect(parsedConfig.themeCSS ?? '').not.toContain('display: none');
    }
  });

  it('skips cancelled and oversized requests instead of scheduling layout', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderMermaidDiagram(example, 'light', controller.signal)).resolves.toBeNull();
    await expect(renderMermaidDiagram('x'.repeat(50_001), 'light', new AbortController().signal)).resolves.toBeNull();
  });
});
