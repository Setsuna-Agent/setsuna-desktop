import type { RuntimeDynamicToolDefinition } from '@setsuna-desktop/contracts';
import { AppServerRpcError } from './errors.js';
import { recordInput, stringInput } from './input.js';

const DYNAMIC_TOOL_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const RESERVED_DYNAMIC_TOOL_NAMESPACES = new Set([
  'api_tool',
  'browser',
  'computer',
  'container',
  'file_search',
  'functions',
  'image_gen',
  'multi_tool_use',
  'python',
  'python_user_visible',
  'submodel_delegator',
  'terminal',
  'web',
]);
const RESERVED_DYNAMIC_TOOL_MODEL_NAMES = new Set([
  'close_agent',
  'resume_agent',
  'send_input',
  'spawn_agent',
  'wait',
]);

export function appServerDynamicToolsInput(value: unknown): RuntimeDynamicToolDefinition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AppServerRpcError(-32602, 'dynamicTools must be an array');
  const tools = value.flatMap((item, index) => appServerDynamicToolEntry(item, `dynamicTools[${index}]`));
  assertUniqueDynamicToolNames(tools);
  return tools;
}

function appServerDynamicToolEntry(value: unknown, path: string): RuntimeDynamicToolDefinition[] {
  const input = recordInput(value);
  const namespaceTools = input.tools ?? input.functions;
  if (Array.isArray(namespaceTools)) {
    const namespace = requiredDynamicIdentifier(input.name, `${path}.name`, 64);
    if (RESERVED_DYNAMIC_TOOL_NAMESPACES.has(namespace)) {
      throw new AppServerRpcError(-32602, `dynamic tool namespace is reserved: ${namespace}`);
    }
    const namespaceDescription = stringInput(input.description) ?? '';
    if (namespaceDescription.length > 1024) {
      throw new AppServerRpcError(-32602, `${path}.description must be at most 1024 characters`);
    }
    return namespaceTools.map((tool, index) => appServerDynamicFunctionTool(
      tool,
      `${path}.tools[${index}]`,
      namespace,
      namespaceDescription,
    ));
  }
  return [appServerDynamicFunctionTool(value, path)];
}

function appServerDynamicFunctionTool(
  value: unknown,
  path: string,
  namespace?: string,
  namespaceDescription = '',
): RuntimeDynamicToolDefinition {
  const input = recordInput(value);
  const toolName = requiredDynamicIdentifier(input.name, `${path}.name`, 128);
  const modelName = namespace ? `${namespace}__${toolName}` : toolName;
  if (RESERVED_DYNAMIC_TOOL_MODEL_NAMES.has(modelName)) {
    throw new AppServerRpcError(-32602, `dynamic tool name is reserved: ${modelName}`);
  }
  const inputSchema = recordInput(input.inputSchema ?? input.input_schema ?? input.parameters ?? input.schema);
  const toolDescription = stringInput(input.description) ?? '';
  return {
    name: modelName,
    namespace,
    toolName,
    description: dynamicToolDescription(namespace, namespaceDescription, toolDescription),
    inputSchema: Object.keys(inputSchema).length ? inputSchema : { type: 'object', properties: {} },
  };
}

function requiredDynamicIdentifier(value: unknown, path: string, maxLength: number): string {
  const text = stringInput(value);
  if (!text) throw new AppServerRpcError(-32602, `Missing required parameter: ${path}`);
  if (text.length > maxLength || !DYNAMIC_TOOL_IDENTIFIER_PATTERN.test(text)) {
    throw new AppServerRpcError(-32602, `${path} must match ${DYNAMIC_TOOL_IDENTIFIER_PATTERN.source} and be at most ${maxLength} characters`);
  }
  return text;
}

function dynamicToolDescription(namespace: string | undefined, namespaceDescription: string, toolDescription: string): string {
  const parts = [
    namespace ? `Namespace: ${namespace}.` : '',
    namespaceDescription,
    toolDescription,
  ].map((part) => part.trim()).filter(Boolean);
  return parts.join('\n') || 'Dynamic tool provided by the AppServer client.';
}

function assertUniqueDynamicToolNames(tools: RuntimeDynamicToolDefinition[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new AppServerRpcError(-32602, `duplicate dynamic tool name: ${tool.name}`);
    names.add(tool.name);
  }
}
