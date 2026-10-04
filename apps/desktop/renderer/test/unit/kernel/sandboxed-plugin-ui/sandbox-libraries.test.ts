import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { loadSandboxedUiLibraries } from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-libraries.js';
import { createSandboxedUiDocument } from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-document.js';

describe('sandbox libraries', () => {
  it('provides a self-contained ECharts runtime that accepts and updates app data without host APIs', async () => {
    const [library] = await loadSandboxedUiLibraries(['echarts']);
    // No imports, network, DOM or Electron capabilities are supplied. SSR lets
    // this exercise the real distribution and its data API without visual tests.
    const context = createContext({ setTimeout, clearTimeout });
    runInContext(library, context);
    const result = runInContext(`
      const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
      try {
        chart.setOption({ animation: false, series: [{ id: 'sales', type: 'pie', data: [{ name: 'A', value: 10 }] }] });
        chart.setOption({ series: [{ id: 'sales', type: 'pie', data: [{ name: 'B', value: 25 }] }] }, { replaceMerge: ['series'] });
        JSON.stringify(chart.getOption().series[0].data);
      } finally {
        chart.dispose();
      }
    `, context);
    expect(JSON.parse(result as string)).toEqual([{ name: 'B', value: 25 }]);
    expect(context.echarts).toBeDefined();
    expect(globalThis).not.toHaveProperty('echarts');
  });

  it('loads libraries after network lockdown and before plugin code without allowing script escape', () => {
    const source = { html: '<main></main>', css: '', js: 'window.appReady = Boolean(window.echarts);' };
    const library = 'window.echarts = {}; const text = "</script><script src=https://example.com>";';
    const document = createSandboxedUiDocument(source, { libraryScripts: [library], size: 'fill' });
    expect(document.indexOf("['RTCPeerConnection'")).toBeLessThan(document.indexOf('window.echarts = {}'));
    expect(document.indexOf('window.echarts = {}')).toBeLessThan(document.indexOf(source.html));
    expect(document.indexOf('window.echarts = {}')).toBeLessThan(document.indexOf(source.js));
    expect(document).not.toContain(library);
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("script-src 'unsafe-inline'");
  });
});
