import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { RuntimeMcpServerInput, RuntimeMcpToolInfo, RuntimeMcpToolList, RuntimeMcpTransport } from '@setsuna-desktop/contracts';

const DEFAULT_TIMEOUT_MS = 15_000;
const MCP_PROTOCOL_VERSION = '2024-11-05';

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export async function fetchMcpServerTools(input: RuntimeMcpServerInput): Promise<RuntimeMcpToolList> {
  try {
    const transport = normalizeTransport(input);
    const timeoutMs = timeoutMsFor(input);
    const tools = transport === 'stdio'
      ? await fetchStdioMcpTools(input, timeoutMs)
      : await fetchHttpMcpTools(input, timeoutMs);
    return { tools: uniqueTools(tools), errors: [] };
  } catch (error) {
    return { tools: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function callMcpServerTool(input: RuntimeMcpServerInput, toolName: string, args: unknown): Promise<{ content: string; data: unknown; isError: boolean }> {
  const result = await callMcpServerToolRaw(input, toolName, args);
  return normalizeToolCallResult(result);
}

export async function callMcpServerToolResponse(input: RuntimeMcpServerInput, toolName: string, args: unknown): Promise<{
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}> {
  return normalizeToolCallResponse(await callMcpServerToolRaw(input, toolName, args));
}

async function callMcpServerToolRaw(input: RuntimeMcpServerInput, toolName: string, args: unknown): Promise<unknown> {
  const transport = normalizeTransport(input);
  const timeoutMs = timeoutMsFor(input);
  return transport === 'stdio'
    ? await callStdioMcpTool(input, toolName, args, timeoutMs)
    : await callHttpMcpTool(input, toolName, args, timeoutMs);
}

export async function readMcpServerResource(input: RuntimeMcpServerInput, uri: string): Promise<{ contents: Array<Record<string, unknown>> }> {
  const transport = normalizeTransport(input);
  const timeoutMs = timeoutMsFor(input);
  const result = transport === 'stdio'
    ? await readStdioMcpResource(input, uri, timeoutMs)
    : await readHttpMcpResource(input, uri, timeoutMs);
  return normalizeResourceReadResult(result);
}

export async function listMcpServerResources(input: RuntimeMcpServerInput): Promise<Array<Record<string, unknown>>> {
  const transport = normalizeTransport(input);
  const timeoutMs = timeoutMsFor(input);
  const result = transport === 'stdio'
    ? await listStdioMcpResources(input, timeoutMs)
    : await listHttpMcpResources(input, timeoutMs);
  return normalizeResources(recordInput(result).resources);
}

export async function listMcpServerResourceTemplates(input: RuntimeMcpServerInput): Promise<Array<Record<string, unknown>>> {
  const transport = normalizeTransport(input);
  const timeoutMs = timeoutMsFor(input);
  const result = transport === 'stdio'
    ? await listStdioMcpResourceTemplates(input, timeoutMs)
    : await listHttpMcpResourceTemplates(input, timeoutMs);
  return normalizeResourceTemplates(recordInput(result).resourceTemplates ?? recordInput(result).resource_templates);
}

async function fetchHttpMcpTools(input: RuntimeMcpServerInput, timeoutMs: number): Promise<RuntimeMcpToolInfo[]> {
  const url = input.url?.trim();
  if (!url) throw new Error('HTTP MCP 需要 URL 后才能获取工具。');
  const headers = mcpHttpHeaders(input);
  let sessionId = '';
  let id = 1;

  const initialize = await postJsonRpc(url, initializeMessage(id++), headers, timeoutMs);
  sessionId = initialize.sessionId;
  assertJsonRpcOk(initialize.message, 'initialize');

  await postJsonRpc(url, initializedMessage(), headers, timeoutMs, sessionId).catch(() => null);
  const list = await postJsonRpc(url, { jsonrpc: '2.0', id: id++, method: 'tools/list', params: {} }, headers, timeoutMs, sessionId);
  assertJsonRpcOk(list.message, 'tools/list');
  return normalizeTools(recordInput(list.message.result).tools);
}

async function listHttpMcpResources(input: RuntimeMcpServerInput, timeoutMs: number): Promise<unknown> {
  return httpMcpRequest(input, timeoutMs, 'resources/list', {});
}

async function listHttpMcpResourceTemplates(input: RuntimeMcpServerInput, timeoutMs: number): Promise<unknown> {
  return httpMcpRequest(input, timeoutMs, 'resources/templates/list', {});
}

async function readHttpMcpResource(input: RuntimeMcpServerInput, uri: string, timeoutMs: number): Promise<unknown> {
  return httpMcpRequest(input, timeoutMs, 'resources/read', { uri });
}

async function httpMcpRequest(input: RuntimeMcpServerInput, timeoutMs: number, method: string, params: unknown): Promise<unknown> {
  const url = input.url?.trim();
  if (!url) throw new Error('HTTP MCP 需要 URL 后才能发送请求。');
  const headers = mcpHttpHeaders(input);
  let sessionId = '';
  let id = 1;

  const initialize = await postJsonRpc(url, initializeMessage(id++), headers, timeoutMs);
  sessionId = initialize.sessionId;
  assertJsonRpcOk(initialize.message, 'initialize');

  await postJsonRpc(url, initializedMessage(), headers, timeoutMs, sessionId).catch(() => null);
  const response = await postJsonRpc(url, {
    jsonrpc: '2.0',
    id: id++,
    method,
    params,
  }, headers, timeoutMs, sessionId);
  assertJsonRpcOk(response.message, method);
  return response.message.result;
}

async function callHttpMcpTool(input: RuntimeMcpServerInput, toolName: string, args: unknown, timeoutMs: number): Promise<unknown> {
  const url = input.url?.trim();
  if (!url) throw new Error('HTTP MCP 需要 URL 后才能调用工具。');
  const headers = mcpHttpHeaders(input);
  let sessionId = '';
  let id = 1;

  const initialize = await postJsonRpc(url, initializeMessage(id++), headers, timeoutMs);
  sessionId = initialize.sessionId;
  assertJsonRpcOk(initialize.message, 'initialize');

  await postJsonRpc(url, initializedMessage(), headers, timeoutMs, sessionId).catch(() => null);
  const call = await postJsonRpc(url, {
    jsonrpc: '2.0',
    id: id++,
    method: 'tools/call',
    params: { name: toolName, arguments: recordInput(args) },
  }, headers, timeoutMs, sessionId);
  assertJsonRpcOk(call.message, `tools/call ${toolName}`);
  return call.message.result;
}

function mcpHttpHeaders(input: RuntimeMcpServerInput): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };

  for (const [headerName, envVar] of Object.entries(input.envHttpHeaders ?? {})) {
    const value = process.env[envVar];
    if (value?.trim()) headers[headerName] = value;
  }

  const bearerTokenEnvVar = input.bearerTokenEnvVar?.trim();
  if (bearerTokenEnvVar) {
    const value = process.env[bearerTokenEnvVar];
    if (value === undefined) {
      throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${input.key}' is not set`);
    }
    if (!value.trim()) {
      throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${input.key}' is empty`);
    }
    headers.Authorization = `Bearer ${value}`;
  }

  return Object.keys(headers).length ? headers : undefined;
}

async function postJsonRpc(
  url: string,
  body: JsonRpcMessage,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
  sessionId = '',
): Promise<{ message: JsonRpcMessage; sessionId: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MCP HTTP ${body.method ?? 'request'} 返回 ${response.status}`);
    const nextSessionId = response.headers.get('mcp-session-id') ?? sessionId;
    if (response.status === 202 || response.status === 204) return { message: { jsonrpc: '2.0' }, sessionId: nextSessionId };
    const text = await response.text();
    return { message: parseHttpMcpMessage(text, response.headers.get('content-type') ?? ''), sessionId: nextSessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStdioMcpTools(input: RuntimeMcpServerInput, timeoutMs: number): Promise<RuntimeMcpToolInfo[]> {
  const command = input.command?.trim();
  if (!command) throw new Error('stdio MCP 需要命令后才能获取工具。');
  const child = spawn(command, input.args ?? [], {
    cwd: input.cwd?.trim() || undefined,
    env: { ...process.env, ...(input.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new StdioMcpClient(child, timeoutMs);
  try {
    await client.request('initialize', initializeMessage(1).params);
    client.notify('notifications/initialized', {});
    const result = await client.request('tools/list', {});
    return normalizeTools(recordInput(result).tools);
  } finally {
    client.close();
  }
}

async function callStdioMcpTool(input: RuntimeMcpServerInput, toolName: string, args: unknown, timeoutMs: number): Promise<unknown> {
  const command = input.command?.trim();
  if (!command) throw new Error('stdio MCP 需要命令后才能调用工具。');
  const child = spawn(command, input.args ?? [], {
    cwd: input.cwd?.trim() || undefined,
    env: { ...process.env, ...(input.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new StdioMcpClient(child, timeoutMs);
  try {
    await client.request('initialize', initializeMessage(1).params);
    client.notify('notifications/initialized', {});
    return await client.request('tools/call', { name: toolName, arguments: recordInput(args) });
  } finally {
    client.close();
  }
}

async function listStdioMcpResources(input: RuntimeMcpServerInput, timeoutMs: number): Promise<unknown> {
  return stdioMcpRequest(input, timeoutMs, 'resources/list', {});
}

async function listStdioMcpResourceTemplates(input: RuntimeMcpServerInput, timeoutMs: number): Promise<unknown> {
  return stdioMcpRequest(input, timeoutMs, 'resources/templates/list', {});
}

async function readStdioMcpResource(input: RuntimeMcpServerInput, uri: string, timeoutMs: number): Promise<unknown> {
  return stdioMcpRequest(input, timeoutMs, 'resources/read', { uri });
}

async function stdioMcpRequest(input: RuntimeMcpServerInput, timeoutMs: number, method: string, params: unknown): Promise<unknown> {
  const command = input.command?.trim();
  if (!command) throw new Error('stdio MCP 需要命令后才能发送请求。');
  const child = spawn(command, input.args ?? [], {
    cwd: input.cwd?.trim() || undefined,
    env: { ...process.env, ...(input.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new StdioMcpClient(child, timeoutMs);
  try {
    await client.request('initialize', initializeMessage(1).params);
    client.notify('notifications/initialized', {});
    return await client.request(method, params);
  } finally {
    client.close();
  }
}

function initializeMessage(id: number): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'setsuna-desktop', version: '0.1.0' },
    },
  };
}

function initializedMessage(): JsonRpcMessage {
  return { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
}

class StdioMcpClient {
  private buffer = Buffer.alloc(0);
  private stderr = '';
  private nextId = 2;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly timeoutMs: number) {
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => this.rejectAll(error));
    child.on('exit', (code) => this.rejectAll(new Error(`MCP stdio 进程退出：${code ?? 'unknown'}${this.stderr ? `, ${this.stderr.slice(0, 300)}` : ''}`)));
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.write({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP stdio ${method} 超时。`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  close(): void {
    this.child.kill();
    this.rejectAll(new Error('MCP stdio client closed.'));
  }

  private write(message: JsonRpcMessage): void {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin.write(`Content-Length: ${payload.byteLength}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      this.resolveMessage(JSON.parse(body) as JsonRpcMessage);
    }
  }

  private resolveMessage(message: JsonRpcMessage): void {
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message || 'MCP stdio request failed.'));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function parseHttpMcpMessage(text: string, contentType: string): JsonRpcMessage {
  if (contentType.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
    const eventData = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .find((line) => line && line !== '[DONE]');
    if (!eventData) return { jsonrpc: '2.0' };
    return JSON.parse(eventData) as JsonRpcMessage;
  }
  return text.trim() ? JSON.parse(text) as JsonRpcMessage : { jsonrpc: '2.0' };
}

function assertJsonRpcOk(message: JsonRpcMessage, label: string): void {
  if (message.error) throw new Error(`MCP ${label} 失败：${message.error.message || 'unknown error'}`);
}

function normalizeTools(value: unknown): RuntimeMcpToolInfo[] {
  return Array.isArray(value)
    ? value
      .map((item): RuntimeMcpToolInfo | null => {
        const record = recordInput(item);
        const name = stringValue(record.name).trim();
        if (!name) return null;
        const description = optionalString(record.description);
        const inputSchema = recordInput(record.inputSchema ?? record.input_schema);
        const annotations = recordInput(record.annotations);
        return {
          name,
          ...(description ? { description } : {}),
          ...(Object.keys(inputSchema).length ? { inputSchema } : {}),
          ...(Object.keys(annotations).length ? { annotations } : {}),
        };
      })
      .filter((item): item is RuntimeMcpToolInfo => Boolean(item))
    : [];
}

function normalizeToolCallResult(result: unknown): { content: string; data: unknown; isError: boolean } {
  const record = recordInput(result);
  return {
    content: mcpContentToText(record.content) || stringifyResult(result),
    data: result,
    isError: record.isError === true,
  };
}

function normalizeToolCallResponse(result: unknown): {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
} {
  const record = recordInput(result);
  const structuredContent = record.structuredContent ?? record.structured_content;
  const meta = record._meta ?? record.meta;
  return {
    content: Array.isArray(record.content) ? record.content : [],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(typeof record.isError === 'boolean' ? { isError: record.isError } : {}),
    ...(meta !== undefined ? { _meta: meta } : {}),
  };
}

function normalizeResourceReadResult(result: unknown): { contents: Array<Record<string, unknown>> } {
  const contents = recordInput(result).contents;
  if (!Array.isArray(contents)) return { contents: [] };
  return {
    contents: contents
      .map((item) => normalizeResourceContent(item))
      .filter((item): item is Record<string, unknown> => Boolean(item)),
  };
}

function normalizeResourceContent(value: unknown): Record<string, unknown> | null {
  const record = recordInput(value);
  const uri = stringValue(record.uri).trim();
  if (!uri) return null;
  const mimeType = optionalString(record.mimeType ?? record.mime_type);
  const text = typeof record.text === 'string' ? record.text : undefined;
  const blob = typeof record.blob === 'string' ? record.blob : undefined;
  if (text === undefined && blob === undefined) return null;
  return {
    uri,
    ...(mimeType ? { mimeType } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(blob !== undefined ? { blob } : {}),
    ...(record._meta !== undefined ? { _meta: record._meta } : {}),
  };
}

function normalizeResources(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeResource(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeResource(value: unknown): Record<string, unknown> | null {
  const record = recordInput(value);
  const uri = stringValue(record.uri).trim();
  const name = stringValue(record.name).trim();
  if (!uri || !name) return null;
  const description = optionalString(record.description);
  const mimeType = optionalString(record.mimeType ?? record.mime_type);
  const title = optionalString(record.title);
  const size = typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : undefined;
  const icons = Array.isArray(record.icons) ? record.icons : undefined;
  return {
    ...(record.annotations !== undefined ? { annotations: record.annotations } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    name,
    ...(size !== undefined ? { size } : {}),
    ...(title ? { title } : {}),
    uri,
    ...(icons ? { icons } : {}),
    ...(record._meta !== undefined ? { _meta: record._meta } : {}),
  };
}

function normalizeResourceTemplates(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeResourceTemplate(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeResourceTemplate(value: unknown): Record<string, unknown> | null {
  const record = recordInput(value);
  const uriTemplate = stringValue(record.uriTemplate ?? record.uri_template).trim();
  const name = stringValue(record.name).trim();
  if (!uriTemplate || !name) return null;
  const title = optionalString(record.title);
  const description = optionalString(record.description);
  const mimeType = optionalString(record.mimeType ?? record.mime_type);
  return {
    ...(record.annotations !== undefined ? { annotations: record.annotations } : {}),
    uriTemplate,
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

function mcpContentToText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const record = recordInput(item);
      if (record.type === 'text') return stringValue(record.text);
      if (record.type === 'resource') return stringifyResult(record.resource);
      return stringifyResult(item);
    })
    .filter(Boolean)
    .join('\n');
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function uniqueTools(tools: RuntimeMcpToolInfo[]): RuntimeMcpToolInfo[] {
  const byName = new Map<string, RuntimeMcpToolInfo>();
  for (const tool of tools) byName.set(tool.name, tool);
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeTransport(input: RuntimeMcpServerInput): RuntimeMcpTransport {
  if (input.transport === 'stdio' || input.transport === 'streamableHttp') return input.transport;
  return input.command ? 'stdio' : 'streamableHttp';
}

function timeoutMsFor(input: RuntimeMcpServerInput): number {
  const timeout = input.toolTimeoutMs ?? input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeout, 1000), 60_000);
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}
