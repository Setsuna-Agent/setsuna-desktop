import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { designMcpName, designMcpToolNames, type DesignMcpRead, type DesignMcpReply } from '../../contracts/design-mcp.js';
import { inspectDesignInput, previewDesignInput } from './read-request.js';

const connectionFile = process.argv[2];
const server = new McpServer({ name: designMcpName, version: '1.0.0' }, {
  instructions: 'Read the visible design draft in Setsuna Desktop. Start with get_active_design, then inspect layers or render a preview.',
});
const id = randomUUID();
const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

server.registerTool(designMcpToolNames.active, {
  description: 'Get the active draft name, ID, revision, selection, and artboards in Setsuna Desktop.',
  annotations,
}, ({ signal }) => read({ kind: 'active' }, signal));
server.registerTool(designMcpToolNames.inspect, {
  description: 'Inspect the active draft or specific layers. For an overview use mode:"index" and maxDepth:1. Use name for an exact lookup, or layerIds with maxDepth:0 to read several known layers together. Continue with nextOffset and the same documentId, revision, and filters.',
  inputSchema: inspectDesignInput,
  annotations,
}, (args, { signal }) => read({ kind: 'inspect', ...args }, signal));
server.registerTool(designMcpToolNames.preview, {
  description: 'Render a PNG of a layer or artboard from the active draft. With no layer ID, render the selection or first visible artboard.',
  inputSchema: previewDesignInput,
  annotations,
}, (args, { signal }) => read({ kind: 'preview', ...args }, signal));

async function read(request: DesignMcpRead, signal: AbortSignal): Promise<CallToolResult> {
  const timeout = AbortSignal.timeout(22_000);
  const deadline = AbortSignal.any([signal, timeout]);
  let reply: DesignMcpReply;
  try {
    // Read the endpoint for each call so an already connected Agent survives a desktop restart.
    const { port, token } = JSON.parse(await readFile(connectionFile, { encoding: 'utf8', signal: deadline }));
    if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== 'string' || !/^[0-9a-f]{64}$/u.test(token)) throw new Error('Invalid endpoint.');
    const agent = { id, name: (server.server.getClientVersion()?.name || 'MCP Agent').slice(0, 80) };
    const response = await fetch(`http://127.0.0.1:${port}/read`, {
      method: 'POST', redirect: 'error', signal: deadline,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: request, agent }),
    });
    reply = await response.json() as DesignMcpReply;
  } catch {
    const error = signal.aborted ? 'The design read was cancelled.' : timeout.aborted ? 'The design read timed out. Retry with a smaller inspection scope.'
      : 'Open Setsuna Desktop and enable or copy the MCP configuration in Design settings.';
    reply = { ok: false, error };
  }
  if (!reply.ok) return { isError: true, content: [{ type: 'text', text: reply.error }] };
  const { content, image } = reply.value;
  return { content: [{ type: 'text', text: content },
    ...(image ? [{ type: 'image' as const, mimeType: 'image/png', data: image.slice('data:image/png;base64,'.length) }] : [])] };
}

void server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
