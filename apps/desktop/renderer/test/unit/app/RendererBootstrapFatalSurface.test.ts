// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { renderRendererBootstrapFatalSurface } from '../../../src/app/RendererBootstrapFatalSurface.js';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.lang = '';
});

describe('RendererBootstrapFatalSurface', () => {
  it('replaces an unmounted root with a static reload surface', () => {
    document.documentElement.lang = 'zh-CN';
    const root = document.createElement('div');
    root.id = 'root';
    root.append(document.createElement('span'));
    document.body.append(root);

    renderRendererBootstrapFatalSurface(new Error('Required Slot is missing'));

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('界面启动失败');
    expect(root.textContent).toContain('Required Slot is missing');
    expect(root.querySelector('button')?.textContent).toBe('重新加载');
    expect(document.activeElement).toBe(root.querySelector('button'));
  });
});
