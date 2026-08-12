import type {
  RuntimeExtensionEventName,
  RuntimeExtensionStatusList,
  RuntimePluginReference,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolTurnCleanupOutcome,
} from './tool-host.js';

export type ExtensionRegisteredTool = RuntimeToolDefinition & {
  localName: string;
  plugin: RuntimePluginReference;
  execution: {
    supportsParallel: boolean;
    requiresApproval: boolean;
    requiresSandboxBypassApproval: boolean;
  };
};

export type ExtensionEventContext = {
  threadId: string;
  turnId?: string;
  projectId?: string;
  toolCallId?: string;
  cwd?: string;
  features?: Record<string, boolean>;
  signal?: AbortSignal;
  payload: Record<string, unknown>;
};

export type ExtensionEventOutcome = {
  block?: boolean;
  reason?: string;
  input?: unknown;
  context?: string[];
  feedback?: string;
};

export type ExtensionStateStore = {
  get(pluginId: string, scope: string, key: string): Promise<unknown>;
  set(pluginId: string, scope: string, key: string, value: unknown): Promise<void>;
  delete(pluginId: string, scope: string, key: string): Promise<void>;
  deletePlugin(pluginId: string): Promise<void>;
};

export type ExtensionRuntime = {
  listTools(context: ToolExecutionContext): Promise<ExtensionRegisteredTool[]>;
  runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  dispatch(eventName: RuntimeExtensionEventName, context: ExtensionEventContext): Promise<ExtensionEventOutcome>;
  cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void>;
  listStatuses(): Promise<RuntimeExtensionStatusList>;
  beginPluginMutation(pluginId: string): Promise<() => Promise<void>>;
  shutdown(): Promise<void>;
};
