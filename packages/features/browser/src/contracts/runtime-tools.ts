import type {
  RuntimeMessageAttachment,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type BrowserToolExecutionContext = Readonly<{
  modelCapabilities?: Readonly<{ supportsImages: boolean }>;
  signal?: AbortSignal;
  toolCallId?: string;
}>;

export type BrowserToolRuntimeProfile = Readonly<{
  exposure?: 'direct' | 'deferred' | 'hidden';
  modelOutputTokenLimit?: number;
  searchAliases?: string[];
}>;

export type BrowserToolApprovalRequirement = Readonly<{
  argumentsPreview?: string;
  reason: string;
}>;

export type BrowserToolExecutionPreview = Readonly<{
  argumentsPreview?: string;
  resultPreview?: string;
}>;

export type BrowserToolExecutionResult = Readonly<{
  attachments?: RuntimeMessageAttachment[];
  containsExternalContext?: boolean;
  content: string;
  data?: unknown;
  preview?: string;
}>;

export interface BrowserRuntimeToolService {
  listTools(context?: BrowserToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  systemPrompt(
    context: BrowserToolExecutionContext,
    request?: Readonly<{ tools: RuntimeToolDefinition[] }>,
  ): string | null;
  toolRuntimeProfile(name: string): BrowserToolRuntimeProfile | null;
  approvalForTool(name: string, input?: unknown): Promise<BrowserToolApprovalRequirement | null>;
  previewToolCall(name: string, input: unknown): Promise<BrowserToolExecutionPreview | null>;
  runTool(
    name: string,
    input: unknown,
    context: BrowserToolExecutionContext,
  ): Promise<BrowserToolExecutionResult>;
}

export const browserRuntimeToolServiceCapability: CapabilityToken<BrowserRuntimeToolService> = defineCapability({
  id: 'browser.runtime-tools',
  description: 'Browser-owned runtime tool definitions and execution service',
});
