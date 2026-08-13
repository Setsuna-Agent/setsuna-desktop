import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AutomaticApprovalReviewer } from '../../../src/loop/approval-review/automatic-approval-reviewer.js';
import {
  parseApprovalReviewOutput,
  policyConstrainedApprovalReviewOutcome,
} from '../../../src/loop/approval-review/approval-review-output.js';
import type { ConfigStore } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { ThreadStore } from '../../../src/ports/thread-store.js';
import type { UsageStore } from '../../../src/ports/usage-store.js';

describe('automatic approval reviewer', () => {
  it('uses the dedicated model and reviews the exact action without hidden messages', async () => {
    const modelClient = new ReviewModelClient(() => JSON.stringify({
      outcome: 'allow',
      riskLevel: 'medium',
      userAuthorization: 'high',
      rationale: 'The user explicitly requested this exact test command.',
    }));
    const recordUsage = vi.fn(async (input: Omit<RuntimeUsageRecord, 'id'>) => ({
      id: 'usage_1',
      ...input,
    }));
    const reviewer = createReviewer(modelClient, { recordUsage });
    const input = reviewInput({ cmd: ['pnpm', 'test', '--filter', 'approval'] });

    const result = await reviewer.review(input);

    expect(result.assessment).toMatchObject({
      status: 'allowed',
      riskLevel: 'medium',
      userAuthorization: 'high',
      providerId: 'review-provider',
      model: 'approval-review-model-code',
    });
    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0]).toMatchObject({
      model: 'approval-review-model-code',
      providerId: 'review-provider',
      toolChoice: 'none',
      thinking: false,
      temperature: 0,
    });
    const [policyMessage, reviewMessage] = modelClient.requests[0]!.messages;
    expect(policyMessage?.content).toContain('high -> allow only when userAuthorization is medium or high');
    expect(policyMessage?.content).toContain('temporary interactive administrator or root shell');
    expect(reviewMessage?.content).toContain('"cmd":["pnpm","test","--filter","approval"]');
    expect(taggedJson(reviewMessage?.content ?? '', 'trusted_user_evidence_json')).toEqual([
      expect.objectContaining({ role: 'user', source: 'user_message', content: 'Run the approval tests.' }),
      expect.objectContaining({ role: 'tool', source: 'request_user_input', content: expect.stringContaining('User submitted structured input') }),
    ]);
    expect(taggedJson(reviewMessage?.content ?? '', 'untrusted_context_json')).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'I will run the requested command.' }),
      expect.objectContaining({ role: 'tool', content: 'Untrusted tool evidence.' }),
    ]);
    expect(reviewMessage?.content).not.toContain('hidden chain of thought');
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  it('fails safely after two invalid structured responses', async () => {
    const modelClient = new ReviewModelClient(() => 'not-json');
    const reviewer = createReviewer(modelClient);

    const result = await reviewer.review(reviewInput({ cmd: 'pnpm test' }));

    expect(result.assessment).toMatchObject({
      status: 'failed',
      rationale: 'Automatic approval review returned an invalid structured decision.',
    });
    expect(modelClient.requests).toHaveLength(2);
  });

  it('trips the per-turn circuit breaker on the third consecutive denial', async () => {
    const modelClient = new ReviewModelClient(() => JSON.stringify({
      outcome: 'deny',
      riskLevel: 'high',
      userAuthorization: 'unknown',
      rationale: 'The destructive target was not authorized.',
    }));
    const reviewer = createReviewer(modelClient);

    const first = await reviewer.review(reviewInput({ cmd: 'rm -rf build' }));
    const second = await reviewer.review(reviewInput({ cmd: 'rm -rf dist' }));
    const third = await reviewer.review(reviewInput({ cmd: 'rm -rf output' }));

    expect(first.interruptTurn).toBeUndefined();
    expect(second.interruptTurn).toBeUndefined();
    expect(third.interruptTurn).toBe(true);
  });
});

describe('approval review output', () => {
  it('accepts a single JSON object and rejects incomplete decisions', () => {
    expect(parseApprovalReviewOutput('```json\n{"outcome":"deny","riskLevel":"critical","userAuthorization":"low","rationale":"Credential export is unsafe."}\n```'))
      .toMatchObject({ outcome: 'deny', riskLevel: 'critical' });
    expect(parseApprovalReviewOutput('{"outcome":"allow","rationale":"missing fields"}')).toBeNull();
  });

  it('cannot allow critical risk or high risk without sufficient authorization', () => {
    expect(policyConstrainedApprovalReviewOutcome({
      outcome: 'allow',
      riskLevel: 'critical',
      userAuthorization: 'high',
      rationale: 'The model attempted to allow a critical action.',
    })).toBe('deny');
    expect(policyConstrainedApprovalReviewOutcome({
      outcome: 'allow',
      riskLevel: 'high',
      userAuthorization: 'low',
      rationale: 'The action lacks sufficient authorization.',
    })).toBe('deny');
    expect(policyConstrainedApprovalReviewOutcome({
      outcome: 'allow',
      riskLevel: 'high',
      userAuthorization: 'high',
      rationale: 'The exact high-risk action was explicitly authorized.',
    })).toBe('allow');
  });
});

class ReviewModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly response: () => string) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: this.response() };
    yield {
      type: 'usage',
      usage: {
        providerId: 'review-provider',
        model: 'approval-review-model-code',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

function createReviewer(
  modelClient: ModelClient,
  usageStore?: Pick<UsageStore, 'recordUsage'>,
) {
  const config = configFixture();
  const configStore = {
    getConfig: async () => config,
  } as unknown as ConfigStore;
  const threadStore = {
    getThread: async () => threadFixture(),
  } as unknown as ThreadStore;
  return new AutomaticApprovalReviewer({
    clock: { now: () => new Date('2026-08-13T00:00:00.000Z') },
    configStore,
    modelClient,
    threadStore,
    usageStore: usageStore as UsageStore | undefined,
  });
}

function reviewInput(argumentsValue: unknown) {
  return {
    arguments: argumentsValue,
    request: {
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      toolName: 'exec_command',
      reason: 'Command requires elevated execution.',
      argumentsPreview: '{"cmd":"truncated"}',
      environmentId: 'local',
    },
    signal: new AbortController().signal,
  };
}

function threadFixture(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Approval review',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    archived: false,
    messageCount: 5,
    lastMessagePreview: 'Run the approval tests.',
    lastSeq: 5,
    messages: [
      {
        id: 'user_1',
        role: 'user',
        content: 'Run the approval tests.',
        createdAt: '2026-08-13T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'I will run the requested command.',
        createdAt: '2026-08-13T00:00:00.500Z',
        status: 'complete',
      },
      {
        id: 'tool_1',
        role: 'tool',
        content: 'Untrusted tool evidence.',
        toolName: 'exec_command',
        createdAt: '2026-08-13T00:00:00.750Z',
        status: 'complete',
      },
      {
        id: 'tool_user_input',
        role: 'tool',
        content: 'User submitted structured input:\n{"confirm":"yes"}',
        toolName: 'request_user_input',
        createdAt: '2026-08-13T00:00:00.900Z',
        status: 'complete',
      },
      {
        id: 'hidden_1',
        role: 'assistant',
        content: 'hidden chain of thought',
        visibility: 'model',
        createdAt: '2026-08-13T00:00:01.000Z',
        status: 'complete',
      },
    ],
  };
}

function taggedJson(content: string, tag: string): unknown {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`, 'u').exec(content);
  return match?.[1] ? JSON.parse(match[1]) : null;
}

function configFixture(): RuntimeConfigState {
  const model = {
    id: 'approval-review-model',
    name: 'Approval review model',
    code: 'approval-review-model-code',
    enabled: true,
    maxOutputTokens: 8_192,
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp',
    storagePath: '/tmp/memories',
    activeProviderId: 'chat-provider',
    providers: [
      {
        id: 'chat-provider',
        name: 'Chat provider',
        provider: 'openai-compatible',
        baseUrl: 'https://chat.example/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{ ...model, id: 'chat-model', code: 'chat-model-code' }],
      },
      {
        id: 'review-provider',
        name: 'Review provider',
        provider: 'openai-compatible',
        baseUrl: 'https://review.example/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [model],
      },
    ],
    globalPrompt: '',
    memory: {
      useMemories: true,
      generateMemories: true,
      disableOnExternalContext: false,
    },
    memoryEnabled: true,
    taskModels: {
      approvalReview: {
        providerId: 'review-provider',
        modelId: 'approval-review-model',
      },
    },
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    approvalReviewer: 'automatic',
    permissionProfile: 'workspace-write',
  };
}
