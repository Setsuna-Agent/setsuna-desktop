import type { RuntimeEvent, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { AppServerRpcError } from './app-server/errors.js';
import type { RuntimeFactory } from './types.js';
import { compareNullableMs, maxNullableMs, minNullableMs, parseDateMs } from './time-utils.js';
import { randomRuntimeId } from './runtime-ids.js';

export { randomRuntimeId } from './runtime-ids.js';

export async function requireRuntimeThread(runtime: RuntimeFactory, threadId: string): Promise<RuntimeThread> {
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
  return thread;
}

export async function settleStaleRuntimeTurns(runtime: RuntimeFactory): Promise<void> {
  const summaries = await runtime.threadStore.listThreads({ includeArchived: true });
  for (const summary of summaries) {
    const thread = await runtime.threadStore.getThread(summary.id);
    if (!thread) continue;
    for (const turnId of activeTurnIdsInThread(thread)) {
      await appendAndPublishRuntimeEvent(runtime, thread.id, {
        id: randomRuntimeId('event_cancel'),
        threadId: thread.id,
        turnId,
        type: 'turn.cancelled',
        createdAt: new Date().toISOString(),
        payload: { reason: 'Turn cancelled because the desktop runtime restarted.' },
      });
    }
  }
}

export async function cancelRuntimeTurn(runtime: RuntimeFactory, threadId: string, turnId: string): Promise<boolean> {
  const cancelled = await runtime.agentLoop.cancelTurn(threadId, turnId);
  if (cancelled) return true;
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread || !runtimeTurnAppearsActive(thread, turnId)) return false;
  await appendAndPublishRuntimeEvent(runtime, threadId, {
    id: randomRuntimeId('event_cancel'),
    threadId,
    turnId,
    type: 'turn.cancelled',
    createdAt: new Date().toISOString(),
    payload: { reason: 'Turn cancelled.' },
  });
  return true;
}

function activeTurnIdsInThread(thread: RuntimeThread): string[] {
  const turnIds = new Set<string>();
  for (const message of thread.messages) {
    if (!message.turnId) continue;
    if (message.status === 'streaming' || message.toolRuns?.some(isActiveRuntimeToolRun)) {
      turnIds.add(message.turnId);
    }
  }
  return [...turnIds];
}

function runtimeTurnAppearsActive(thread: RuntimeThread, turnId: string): boolean {
  return activeTurnIdsInThread(thread).includes(turnId);
}

function isActiveRuntimeToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}

export async function runAppServerThreadShellCommand(
  runtime: RuntimeFactory,
  thread: RuntimeThread,
  command: string,
  activeTurnId: string | null = null,
): Promise<void> {
  const turnId = activeTurnId ?? randomRuntimeId('turn_shell');
  const toolCallId = randomRuntimeId('call_shell');
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const argumentsPreview = JSON.stringify({ command, risk_level: 'low', yield_time_ms: 0 });
  const deltaPublishes: Promise<void>[] = [];
  const standaloneTurn = !activeTurnId;
  const holderMessageId = threadHasAssistantForTurn(thread, turnId) ? null : randomRuntimeId('msg_shell');

  if (standaloneTurn) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'turn.started',
      createdAt: startedAt,
      payload: { input: command },
    });
  }
  if (holderMessageId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.created',
      createdAt: startedAt,
      payload: {
        message: {
          id: holderMessageId,
          turnId,
          role: 'assistant',
          content: '',
          createdAt: startedAt,
          status: 'streaming',
        },
      },
    });
  }
  await appendAndPublishRuntimeEvent(runtime, thread.id, {
    id: randomRuntimeId('event'),
    threadId: thread.id,
    turnId,
    type: 'tool.started',
    createdAt: startedAt,
    payload: {
      toolCallId,
      toolName: 'run_shell_command',
      source: 'userShell',
      argumentsPreview,
    },
  });

  let status: 'success' | 'error' = 'success';
  let content = '';
  let data: unknown;
  try {
    const result = await runtime.toolHost.runTool('run_shell_command', {
      command,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: thread.id,
      projectId: thread.projectId,
      turnId,
      toolCallId,
      permissionProfile: 'danger-full-access',
      onToolOutputDelta: (delta) => {
        const publish = appendAndPublishRuntimeEvent(runtime, thread.id, {
          id: randomRuntimeId('event'),
          threadId: thread.id,
          turnId,
          type: 'tool.output_delta',
          createdAt: new Date().toISOString(),
          payload: {
            toolCallId,
            toolName: 'run_shell_command',
            source: 'userShell',
            delta: delta.delta,
            stream: delta.stream,
            processId: delta.processId,
          },
        }).then(() => undefined, () => undefined);
        deltaPublishes.push(publish);
      },
    });
    content = result.content;
    data = result.data;
  } catch (error) {
    status = 'error';
    content = error instanceof Error ? error.message : String(error);
  }

  await Promise.all(deltaPublishes);
  const completedAt = new Date();
  await appendAndPublishRuntimeEvent(runtime, thread.id, {
    id: randomRuntimeId('event'),
    threadId: thread.id,
    turnId,
    type: 'tool.completed',
    createdAt: completedAt.toISOString(),
    payload: {
      toolCallId,
      toolName: 'run_shell_command',
      source: 'userShell',
      status,
      content,
      argumentsPreview,
      data,
      durationMs: Math.max(0, completedAt.getTime() - startedAtMs),
    },
  });
  if (holderMessageId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.completed',
      createdAt: completedAt.toISOString(),
      payload: { messageId: holderMessageId },
    });
  }
  if (activeTurnId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.created',
      createdAt: new Date().toISOString(),
      payload: {
        message: {
          id: randomRuntimeId('msg_shell'),
          turnId,
          role: 'tool',
          toolCallId,
          toolName: 'run_shell_command',
          content,
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
      },
    });
  }
  if (standaloneTurn) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'turn.completed',
      createdAt: new Date().toISOString(),
      payload: {},
    });
  }
}

function threadHasAssistantForTurn(thread: RuntimeThread, turnId: string): boolean {
  return thread.messages.some((message) => message.turnId === turnId && message.role === 'assistant');
}

export async function appendAndPublishRuntimeEvent(
  runtime: RuntimeFactory,
  threadId: string,
  event: Omit<RuntimeEvent, 'seq'>,
): Promise<RuntimeEvent> {
  const saved = await runtime.threadStore.appendEvent(threadId, event);
  runtime.eventBus.publish(saved);
  return saved;
}

export async function copyRuntimeMessagesToThread(
  runtime: RuntimeFactory,
  threadId: string,
  messages: RuntimeMessage[],
): Promise<void> {
  let index = 0;
  for (const message of messages) {
    index += 1;
    const createdAt = new Date().toISOString();
    await runtime.threadStore.appendEvent(threadId, {
      id: `event_fork_${message.id}_${index}`,
      threadId,
      turnId: message.turnId,
      type: 'message.created',
      createdAt,
      payload: { message: cloneRuntimeMessage(message) },
    });
  }
}

export function runtimeMessagesThroughTurn(messages: RuntimeMessage[], lastTurnId: string | undefined): RuntimeMessage[] {
  if (!lastTurnId) return messages;
  const order = runtimeTurnOrder(messages);
  const cutoff = order.get(lastTurnId);
  if (!cutoff) throw new AppServerRpcError(-32602, `Unknown lastTurnId: ${lastTurnId}`);
  return messages.filter((message) => {
    if (message.turnId) return (order.get(message.turnId)?.order ?? Number.POSITIVE_INFINITY) <= cutoff.order;
    const createdAtMs = parseDateMs(message.createdAt);
    return createdAtMs !== null && compareNullableMs(createdAtMs, cutoff.endMs) <= 0;
  });
}

export function rollbackStartMessageId(messages: RuntimeMessage[], numTurns: number): string | null {
  const order = runtimeTurnOrder(messages);
  if (!order.size) return null;
  const firstDroppedOrder = Math.max(0, order.size - numTurns);
  const firstDropped = [...order.entries()].find(([, turn]) => turn.order === firstDroppedOrder);
  if (!firstDropped) return null;
  const [turnId] = firstDropped;
  return messages.find((message) => message.turnId === turnId)?.id ?? null;
}

function runtimeTurnOrder(messages: RuntimeMessage[]): Map<string, { endMs: number | null; order: number }> {
  const turns = new Map<string, { endMs: number | null; firstIndex: number; startMs: number | null; turnId: string }>();
  for (const [index, message] of messages.entries()) {
    if (!message.turnId) continue;
    const createdAtMs = parseDateMs(message.createdAt);
    const existing = turns.get(message.turnId);
    if (!existing) {
      turns.set(message.turnId, {
        endMs: createdAtMs,
        firstIndex: index,
        startMs: createdAtMs,
        turnId: message.turnId,
      });
      continue;
    }
    existing.firstIndex = Math.min(existing.firstIndex, index);
    existing.startMs = minNullableMs(existing.startMs, createdAtMs);
    existing.endMs = maxNullableMs(existing.endMs, createdAtMs);
  }

  return new Map(
    [...turns.values()]
      .sort((left, right) => compareNullableMs(left.startMs, right.startMs) || left.firstIndex - right.firstIndex)
      .map((turn, index) => [turn.turnId, { endMs: turn.endMs, order: index }]),
  );
}

function cloneRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}
