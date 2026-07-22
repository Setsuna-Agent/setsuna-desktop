import type { RuntimeMessage, RuntimePromptManifestEntry } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { estimateTextTokens } from './context-compaction.js';

export type RuntimePromptFragment = {
  id: string;
  role: RuntimePromptManifestEntry['role'];
  source: RuntimePromptManifestEntry['source'];
  trust: RuntimePromptManifestEntry['trust'];
  lifecycle: RuntimePromptManifestEntry['lifecycle'];
  content: string;
  sourcePath?: string;
  turnId?: string;
};

type CompileRuntimePromptInput = {
  fragments: RuntimePromptFragment[];
  conversationMessages: RuntimeMessage[];
  createdAt: string;
};

export type CompiledRuntimePrompt = {
  messages: RuntimeMessage[];
  manifest: RuntimePromptManifestEntry[];
};

const ROLE_ORDER: Record<RuntimePromptFragment['role'], number> = {
  system: 0,
  developer: 1,
  user: 2,
  assistant: 3,
};

/**
 * 在对话历史之前编译临时 runtime 上下文，同时保留每个片段消息角色所携带的权限边界。
 */
export function compileRuntimePrompt({ fragments, conversationMessages, createdAt }: CompileRuntimePromptInput): CompiledRuntimePrompt {
  const normalized = fragments
    .map((fragment, index) => ({ ...fragment, content: fragment.content.trim(), index }))
    .filter((fragment) => Boolean(fragment.content))
    .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.index - right.index);

  return {
    messages: [
      ...normalized.map(({ index: _index, source: _source, trust: _trust, lifecycle: _lifecycle, sourcePath: _sourcePath, ...fragment }) => ({
        id: fragment.id,
        ...(fragment.turnId ? { turnId: fragment.turnId } : {}),
        role: fragment.role,
        content: fragment.content,
        createdAt,
        status: 'complete' as const,
        visibility: 'model' as const,
      })),
      ...conversationMessages,
    ],
    manifest: normalized.map((fragment) => ({
      id: fragment.id,
      role: fragment.role,
      source: fragment.source,
      trust: fragment.trust,
      lifecycle: fragment.lifecycle,
      estimatedTokens: estimateTextTokens(`${fragment.role}\n${fragment.content}`),
      contentHash: `sha256:${createHash('sha256').update(fragment.content).digest('hex')}`,
      ...(fragment.sourcePath ? { sourcePath: fragment.sourcePath } : {}),
    })),
  };
}
