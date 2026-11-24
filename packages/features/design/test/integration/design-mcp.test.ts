import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { expect, it, vi } from 'vitest';
import { createElectronBuildOptions } from '../../../../../scripts/build-electron.js';
import type { DesignMcpCanvasEvent } from '../../src/contracts/design-mcp.js';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/document.js';
import { DesignMcpCanvasBroker } from '../../src/main/mcp/canvas-broker.js';
import { DesignMcpIntegration } from '../../src/main/mcp/integration.js';
import { designMcpEntry, designMcpName, updateDesignMcpClient, type DesignMcpStdio } from '../../src/main/mcp/client-config.js';
import { loadDesignLayoutEngine } from '../../src/renderer/canvas/design-layout-engine.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { readDesignMcpCanvas, type DesignMcpCanvasView } from '../../src/renderer/mcp/read-design-canvas.js';

async function inspectionCanvas(): Promise<DesignMcpCanvasView> {
  const frame = (name: string, childIds: string[]) => ({ kind: 'frame' as const, name, x: 0, y: 0, width: 320, height: 160, childIds });
  const title = (character: string) => ({ kind: 'text' as const, name: 'Header', x: 0, y: 0, width: 200, fontSize: 14, text: character.repeat(18_000) });
  const document: DesignDocument = {
    documentId: 'catalog', schemaVersion: designDocumentVersion, rootIds: ['grid', 'list', 'notes'], nodes: {
      grid: frame('Grid', ['grid-header']), 'grid-header': frame('Header', ['grid-title']), 'grid-title': title('A'),
      list: frame('List', ['list-header']), 'list-header': frame('Header', ['list-title']), 'list-title': title('B'),
      notes: frame('Notes', []),
    },
  };
  const layoutEngine = await loadDesignLayoutEngine();
  return { name: 'Catalog', revision: 'edit:1', selection: ['notes'], document, layoutEngine, projected: document,
    resources: emptyDesignLibraryResources, scene: resolveDesignScene(layoutEngine, document, () => ({ width: 200, height: 20 })),
    preview: async () => { throw new Error('This canvas is a layer inspection fixture.'); } };
}

it('serves only the active canvas over stdio and revokes a disabled client independently', async () => {
  const view = await inspectionCanvas();
  const root = await mkdtemp(join(tmpdir(), 'setsuna-design-mcp-'));
  const files = { codex: join(root, 'config.toml'), 'claude-code': join(root, '.claude.json') };
  const worker = join(root, 'dist', 'electron', designMcpEntry);
  const signal = new AbortController().signal;
  const started = Promise.withResolvers<Extract<DesignMcpCanvasEvent, { kind: 'read' }>>();
  const codexBeforeDisable = Promise.withResolvers<Extract<DesignMcpCanvasEvent, { kind: 'read' }>>();
  const manualStarted = Promise.withResolvers<Extract<DesignMcpCanvasEvent, { kind: 'read' }>>();
  let holdCodex = false;
  let holdManual = false;
  let activeSender = 1;
  let copied = '';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
  const cancelled: string[] = [];
  const canvas = new DesignMcpCanvasBroker(() => activeSender, (sender, event) => {
    if (event.kind === 'cancel') cancelled.push(event.requestId);
    else if (sender === 1) started.resolve(event);
    else if (holdCodex && event.agent.name === 'Codex') codexBeforeDisable.resolve(event);
    else if (holdManual && event.agent.name === 'Other client') manualStarted.resolve(event);
    else if (event.read.kind === 'inspect') {
      void readDesignMcpCanvas(view, event.read, () => undefined, signal).then(
        (value) => canvas.reply(sender, event.requestId, { ok: true, value }),
        (error: Error) => canvas.reply(sender, event.requestId, { ok: false, error: error.message }),
      );
    }
    else canvas.reply(sender, event.requestId, { ok: true, value: {
      content: 'Current canvas',
      image: event.read.kind === 'preview' ? `data:image/png;base64,${png}` : undefined,
    } });
    return true;
  });
  const createIntegration = () => new DesignMcpIntegration({
    directory: join(root, 'endpoints'), appRoot: root, clientFiles: files,
    executable: () => process.execPath,
    writeJsonAtomically: (file, value) => writeFile(file, JSON.stringify(value), { mode: 0o600 }),
    copyText: (text) => { copied = text; },
  }, canvas);
  let integration = createIntegration();
  const codex = new Client({ name: 'codex', version: '1.0.0' });
  const manual = new Client({ name: 'Other client', version: '1.0.0' });
  const renewed = new Client({ name: 'Renewed client', version: '1.0.0' });
  const codexOriginal = '# Personal config\nmcp_servers = { personal = { command = "personal-server" } }\n';
  const claudeOriginal = { projects: { '/test': { hasTrustDialogAccepted: true } }, mcpServers: { personal: { type: 'http', url: 'https://example.com/mcp' } } };
  try {
    const repoRoot = resolve(import.meta.dirname, '../../../../..');
    const options = createElectronBuildOptions(repoRoot).find(({ outfile }) => outfile && basename(outfile) === designMcpEntry)!;
    await Promise.all([
      build({ ...options, outfile: worker }),
      writeFile(files.codex, codexOriginal),
      writeFile(files['claude-code'], JSON.stringify(claudeOriginal)),
    ]);
    await expect(integration.settings(signal)).resolves.toEqual({ codex: false, 'claude-code': false, manual: false });
    await integration.setEnabled('codex', true, signal);
    await integration.setEnabled('claude-code', true, signal);
    await integration.copyConfig(signal);
    const enabledCodexConfig = await readFile(files.codex, 'utf8');
    const codexConfig = getStaticTOMLValue(parseTOML(enabledCodexConfig)).mcp_servers as Record<string, DesignMcpStdio>;
    await codex.connect(new StdioClientTransport(codexConfig[designMcpName]));
    const manualConfig = JSON.parse(copied).mcpServers[designMcpName] as DesignMcpStdio;
    await manual.connect(new StdioClientTransport(manualConfig));

    const noDraft = await codex.callTool({ name: 'get_active_design' });
    expect(noDraft).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Open a design draft') }] });
    canvas.setCanvas(1, 'first', true);
    canvas.setCanvas(2, 'second', true);
    const preview = codex.callTool({ name: 'preview_design', arguments: { layerId: 'artboard' } });
    const pending = await Promise.race([started.promise, preview.then(() => { throw new Error('The preview ended before reaching the canvas.'); })]);
    expect(pending).toMatchObject({ canvasId: 'first', read: { kind: 'preview', layerId: 'artboard' }, agent: { name: 'Codex' } });
    canvas.reply(2, pending.requestId, { ok: true, value: { content: 'Another renderer tried to respond' } });
    activeSender = 2;
    canvas.activeChanged();
    canvas.reply(1, pending.requestId, { ok: true, value: { content: 'Previous canvas' } });
    await expect(preview).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining('active design changed') }] });
    expect(cancelled).toContain(pending.requestId);
    await expect(codex.callTool({ name: 'preview_design', arguments: { layerId: 'artboard' } })).resolves.toMatchObject({
      content: [{ text: 'Current canvas' }, { type: 'image', mimeType: 'image/png', data: png }],
    });

    async function inspect(args: Record<string, unknown>) {
      const reply = await codex.callTool({ name: 'inspect_design', arguments: { documentId: 'catalog', revision: 'edit:1', ...args } });
      const content = Array.isArray(reply.content) ? reply.content[0] : undefined;
      if (reply.isError || content?.type !== 'text') throw new Error(content?.text ?? 'Missing inspection result.');
      return JSON.parse(content.text);
    }
    const headers = { layerIds: ['grid', 'list'], mode: 'index', name: 'Header', maxDepth: 1, limit: 1 };
    const first = await inspect(headers);
    expect(first).toMatchObject({ documentId: 'catalog', revision: 'edit:1', scope: 'layers', layerIds: headers.layerIds,
      selection: ['notes'], layers: [{ id: 'grid-header' }], nextOffset: 1 });
    const second = await inspect({ ...headers, offset: first.nextOffset });
    expect(second.layers).toMatchObject([{ id: 'list-header' }]);
    expect(second.nextOffset).toBeUndefined();

    const roots = await inspect({ layerIds: ['grid', 'grid-header', 'list-header'], maxDepth: 0 });
    expect(roots.layers).toMatchObject([{ id: 'grid' }, { id: 'grid-header' }, { id: 'list-header' }]);
    const details = { layerIds: ['grid-title', 'list-title'], maxDepth: 0 };
    const detailPage = await inspect(details);
    expect(detailPage.layers).toMatchObject([{ id: 'grid-title', node: { text: 'A'.repeat(18_000) } }]);
    expect(detailPage.nextOffset).toBe(1);
    expect((await inspect({ ...details, offset: detailPage.nextOffset })).layers).toMatchObject([{ id: 'list-title', node: { text: 'B'.repeat(18_000) } }]);

    holdCodex = true;
    const pendingDisable = codex.callTool({ name: 'get_active_design' });
    const heldCodex = await Promise.race([codexBeforeDisable.promise, pendingDisable.then(() => { throw new Error('Codex read ended before reaching the canvas.'); })]);
    await writeFile(files.codex, 'mcp_servers = [');
    await expect(integration.setEnabled('codex', false, signal)).rejects.toThrow('invalid TOML');
    await expect(integration.settings(signal)).resolves.toEqual({ codex: false, 'claude-code': true, manual: true });
    await expect(pendingDisable).resolves.toMatchObject({ isError: true });
    expect(cancelled).toContain(heldCodex.requestId);
    holdCodex = false;
    await expect(codex.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ isError: true });
    await expect(manual.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ content: [{ text: 'Current canvas' }] });

    // A valid client entry left on disk cannot restore permission after the app restarts.
    await writeFile(files.codex, enabledCodexConfig);
    await integration.dispose();
    integration = createIntegration();
    await expect(integration.settings(signal)).resolves.toEqual({ codex: false, 'claude-code': true, manual: true });
    await expect(manual.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ content: [{ text: 'Current canvas' }] });
    await expect(codex.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ isError: true });

    await integration.setEnabled('codex', true, signal);
    holdManual = true;
    const reading = manual.callTool({ name: 'get_active_design' });
    const held = await Promise.race([manualStarted.promise, reading.then(() => { throw new Error('Manual read ended before entering the canvas.'); })]);
    await expect(integration.revokeManual(signal)).resolves.toEqual({ codex: true, 'claude-code': true, manual: false });
    await expect(reading).resolves.toMatchObject({ isError: true });
    expect(cancelled).toContain(held.requestId);
    holdManual = false;
    await expect(codex.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ content: [{ text: 'Current canvas' }] });

    await integration.dispose();
    integration = createIntegration();
    await expect(integration.settings(signal)).resolves.toMatchObject({ manual: false });
    await expect(integration.copyConfig(signal)).resolves.toMatchObject({ manual: true });
    const renewedConfig = JSON.parse(copied).mcpServers[designMcpName] as DesignMcpStdio;
    await renewed.connect(new StdioClientTransport(renewedConfig));
    await expect(manual.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ isError: true });
    await expect(renewed.callTool({ name: 'get_active_design' })).resolves.toMatchObject({ content: [{ text: 'Current canvas' }] });
    await integration.setEnabled('codex', false, signal);
    await integration.setEnabled('claude-code', false, signal);
    expect(await readFile(files.codex, 'utf8')).toBe(codexOriginal);
    expect(JSON.parse(await readFile(files['claude-code'], 'utf8'))).toEqual(claudeOriginal);
  } finally {
    await Promise.allSettled([codex.close(), manual.close(), renewed.close(), integration.dispose()]);
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps a failed startup grant visible and revokes it before cleaning up the offline client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'setsuna-design-mcp-restore-'));
  const directory = join(root, 'endpoints');
  const files = { codex: join(root, 'config.toml'), 'claude-code': join(root, '.claude.json') };
  const signal = new AbortController().signal;
  const canvas = new DesignMcpCanvasBroker(() => undefined, () => false);
  const makeIntegration = () => new DesignMcpIntegration({
    directory, appRoot: root, clientFiles: files, executable: () => process.execPath,
    writeJsonAtomically: (file, value) => writeFile(file, JSON.stringify(value), { mode: 0o600 }), copyText: () => undefined,
  }, canvas);
  let integration = makeIntegration();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await integration.setEnabled('codex', true, signal);
    const workingConfig = await readFile(files.codex, 'utf8');
    await integration.dispose();
    await writeFile(files.codex, 'mcp_servers = [');
    integration = makeIntegration();

    await expect(integration.settings(signal)).resolves.toMatchObject({ codex: true });
    expect(warn).toHaveBeenCalledWith('[design-mcp] Could not restore codex:', expect.any(Error));
    await expect(integration.setEnabled('codex', false, signal)).rejects.toThrow('invalid TOML');
    await expect(integration.settings(signal)).resolves.toMatchObject({ codex: false });
    await expect(readFile(join(directory, 'codex.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(files.codex, workingConfig);
    await integration.dispose();
    integration = makeIntegration();
    await expect(integration.settings(signal)).resolves.toMatchObject({ codex: false });
    await expect(readFile(join(directory, 'codex.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    warn.mockRestore();
    await integration.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['codex', 'manual'] as const)('does not restore a new %s grant whose endpoint write failed after rename', async (source) => {
  const root = await mkdtemp(join(tmpdir(), 'setsuna-design-mcp-write-failed-'));
  const directory = join(root, 'endpoints');
  const clientFiles = { codex: join(root, 'config.toml'), 'claude-code': join(root, '.claude.json') };
  const signal = new AbortController().signal;
  const canvas = new DesignMcpCanvasBroker(() => undefined, () => false);
  const copyText = vi.fn();
  const write = (file: string, value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 });
  const makeIntegration = (writeJsonAtomically = write) => new DesignMcpIntegration({
    directory, appRoot: root, clientFiles, executable: () => process.execPath, writeJsonAtomically, copyText,
  }, canvas);
  let integration = makeIntegration(async (file, value) => {
    await write(file, value);
    throw new Error('Endpoint directory sync failed');
  });
  try {
    const enable = source === 'manual' ? integration.copyConfig(signal) : integration.setEnabled(source, true, signal);
    await expect(enable).rejects.toThrow('Endpoint directory sync failed');
    expect(await readdir(directory)).toEqual([]);
    expect(copyText).not.toHaveBeenCalled();

    await integration.dispose();
    integration = makeIntegration();
    await expect(integration.settings(signal)).resolves.toEqual({ codex: false, 'claude-code': false, manual: false });
  } finally {
    await integration.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

it('preserves an existing server with the same name in either client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'setsuna-design-mcp-config-'));
  const signal = new AbortController().signal;
  const config: DesignMcpStdio = { command: process.execPath, args: [join(root, designMcpEntry), join(root, 'endpoint.json')],
    env: { ELECTRON_RUN_AS_NODE: '1' } };
  try {
    const entries = [
      ['codex', 'config.toml', '[mcp_servers."setsuna-design"]\nurl = "https://example.com/mcp"\n'],
      ['claude-code', '.claude.json', '{"mcpServers":{"setsuna-design":{"type":"stdio","command":"other-server"}}}'],
    ] as const;
    for (const [client, name, source] of entries) {
      const file = join(root, name);
      await writeFile(file, source);
      await expect(updateDesignMcpClient(file, client, config, true, signal)).rejects.toThrow('already has a setsuna-design MCP server');
      await updateDesignMcpClient(file, client, config, false, signal);
      expect(await readFile(file, 'utf8')).toBe(source);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
