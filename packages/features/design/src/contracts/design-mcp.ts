export const designMcpName = 'setsuna-design';
export const designMcpToolNames = {
  active: 'get_active_design',
  inspect: 'inspect_design',
  preview: 'preview_design',
} as const;

export const designMcpClients = ['codex', 'claude-code'] as const;
export type DesignMcpClient = typeof designMcpClients[number];
/** Persisted client grants, independent of whether their endpoints could be restored. */
export type DesignMcpSettings = Readonly<Record<DesignMcpClient | 'manual', boolean>>;

export const designMcpChannels = {
  settings: 'design:mcp-settings',
  setEnabled: 'design:mcp-set-enabled',
  copyConfig: 'design:mcp-copy-config',
  revokeManual: 'design:mcp-revoke-manual',
  canvas: 'design:mcp-canvas',
  request: 'design:mcp-request',
  reply: 'design:mcp-reply',
} as const;

type DesignMcpTarget = { documentId?: string; revision?: string; layerId?: string };
export type DesignMcpRead = { kind: 'active' }
  | ({ kind: 'inspect'; mode?: 'index' | 'layers'; layerIds?: readonly string[]; name?: string; maxDepth?: number;
    offset?: number; limit?: number } & DesignMcpTarget)
  | ({ kind: 'preview' } & DesignMcpTarget);
export type DesignMcpReadResult = { content: string; image?: string };
export type DesignMcpReply = { ok: true; value: DesignMcpReadResult } | { ok: false; error: string };
export type DesignMcpAgent = { id: string; name: string };
export type DesignMcpCanvasEvent =
  | { kind: 'read'; canvasId: string; requestId: string; read: DesignMcpRead; agent: DesignMcpAgent }
  | { kind: 'cancel'; canvasId: string; requestId: string };

export interface DesignMcpBridge {
  settings(): Promise<DesignMcpSettings>;
  setEnabled(client: DesignMcpClient, enabled: boolean): Promise<DesignMcpSettings>;
  copyConfig(): Promise<DesignMcpSettings>;
  revokeManual(): Promise<DesignMcpSettings>;
  setCanvas(canvasId: string, visible: boolean): void;
  onRequest(listener: (event: DesignMcpCanvasEvent) => void): () => void;
  reply(requestId: string, reply: DesignMcpReply): void;
}

export type DesignMcpPreloadContribution = Readonly<{ designMcp?: DesignMcpBridge }>;
