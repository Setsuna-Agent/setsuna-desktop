import { describe, expect, it } from 'vitest';
import { mcpToolExecutionResult } from '../../../src/adapters/mcp/mcp-tool-result.js';

describe('mcpToolExecutionResult', () => {
  it('maps image content to model attachments without persisting base64 in result data', () => {
    const result = mcpToolExecutionResult({
      content: [
        { type: 'text', text: 'Rendered diagram.' },
        { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
      ],
      isError: false,
    }, {
      threadId: 'thread_1',
      toolCallId: 'call_1',
      modelCapabilities: { supportsImages: true },
    }, 'design', 'render');

    expect(result.content).toBe('Rendered diagram.');
    expect(result.attachments).toEqual([expect.objectContaining({
      id: 'mcp_design_call_1',
      name: 'design-render-2.png',
      type: 'image/png',
      size: 5,
      url: 'data:image/png;base64,aW1hZ2U=',
    })]);
    expect(JSON.stringify(result.data)).not.toContain('aW1hZ2U=');
    expect(JSON.stringify(result.data)).toContain('base64 omitted');
  });

  it('does not expose unsupported binary content as base64 text', () => {
    const result = mcpToolExecutionResult({
      content: [
        { type: 'image', mimeType: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=' },
        { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' },
        { type: 'resource', resource: { uri: 'memo://blob', mimeType: 'application/octet-stream', blob: 'YmluYXJ5' } },
      ],
      isError: false,
    }, {
      threadId: 'thread_1',
      modelCapabilities: { supportsImages: true },
    }, 'binary', 'read');

    expect(result.attachments).toBeUndefined();
    expect(result.content).toContain('[MCP image omitted: image/svg+xml]');
    expect(result.content).toContain('[MCP audio omitted: audio/wav]');
    expect(result.content).toContain('[MCP resource omitted: application/octet-stream, memo://blob]');
    expect(result.content).not.toContain('PHN2');
    expect(result.content).not.toContain('YXV');
  });
});
