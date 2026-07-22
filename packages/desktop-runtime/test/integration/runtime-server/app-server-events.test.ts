import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  nodeCommand,
} from '../../support/runtime-server/app-server-events.js';
import {
  createRuntimeServerTestHarness,
  longIntegrationTestTimeoutMs,
  mediumIntegrationTestTimeoutMs,
  type RuntimeServerTestHarness,
} from '../../support/runtime-server/harness.js';
import {
  createDelayedOpenAiCaptureServer,
  createOpenAiCaptureServer,
  withTimeout
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer events and shell turns', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('passes per-turn skill ids through the runtime API', async () => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'capture-provider',
            providers: [
              {
                id: 'capture-provider',
                name: 'Capture provider',
                provider: 'openai-compatible',
                baseUrl: capture.baseUrl,
                apiKey: 'sk-capture',
                enabled: true,
                models: [
                  {
                    id: 'capture-model',
                    name: 'Capture model',
                    code: 'capture-model',
                    enabled: true,
                    maxOutputTokens: 1000,
                    thinkingEnabled: false,
                    thinkingEfforts: [],
                  },
                ],
              },
            ],
          }),
        });
        const skill = await harness.runtimeFetch('/v1/skills', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Runtime API Skill',
            content: '# Runtime API Skill\n\nInjected via per-turn skill ids.',
            selected: false,
          }),
        });
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Skill API' }),
        });
  
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: 'Use the API skill.', skillIds: [skill.id] }),
        });
        const body = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for captured provider request');
        const messages = Array.isArray(body.messages) ? body.messages : [];
  
        expect(started).toMatchObject({ accepted: true });
        expect(body.model).toBe('capture-model');
        expect(messages[0]).toMatchObject({ role: 'system' });
        expect(messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Injected via per-turn skill ids.'),
          }),
        ]));
      } finally {
        await capture.close();
      }
    });
  
  it('clears thread context through the runtime API and exposes the event stream update', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Clear context' }),
      });
      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Write a local smoke response.' }),
      });
      const populated = await harness.waitForThread(thread.id, (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'));
  
      const cleared = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/context`, { method: 'DELETE' });
      const hasClearedEvent = await harness.readRuntimeEvent(thread.id, populated.lastSeq, 'thread.context_cleared');
  
      expect(populated.messageCount).toBeGreaterThan(0);
      expect(cleared).toMatchObject({ id: thread.id, messageCount: 0, lastMessagePreview: '', messages: [] });
      expect(hasClearedEvent).toBe(true);
    });
  
  it('exposes AppServer-style SWE notifications from the event stream when requested', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'AppServer SWE events' }),
      });
      const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Write a local smoke response.' }),
      });
  
      const hasAppServerStarted = await harness.readEventStreamContains(
        thread.id,
        0,
        '"method":"turn/started"',
        { format: 'swe' },
      );
      const hasThreadStatus = await harness.readEventStreamContains(
        thread.id,
        0,
        '"method":"thread/status/changed"',
        { format: 'swe' },
      );
  
      expect(started).toMatchObject({ accepted: true });
      expect(hasAppServerStarted).toBe(true);
      expect(hasThreadStatus).toBe(true);
    });
  
  it('streams AppServer-style context compaction lifecycle notifications', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'AppServer SWE context compaction' }),
      });
      // 让准备轮次低于初始自动压缩阈值，再在后续轮次前降低预算，
      // 使压缩事件归属于 compactingTurn。
      await harness.configureSmokeProviderContextWindow(400_000);
      const oversizedHistory = 'older context '.repeat(90_000);
      const initialTurn = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: oversizedHistory }),
      });
      await expect(harness.readRuntimeEvent(thread.id, 0, 'turn.completed', { timeoutMs: 10_000 })).resolves.toBe(true);
      const beforeCompaction = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`) as RuntimeThread;
      expect(beforeCompaction.messages.some((message) => message.contextCompaction)).toBe(false);
      await harness.configureSmokeProviderContextWindow(256_000);
      const compactingTurn = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Continue after compaction.' }),
      });
  
      await expect(harness.readRuntimeEvent(thread.id, beforeCompaction.lastSeq, 'thread.context_compacted', { timeoutMs: 15_000 })).resolves.toBe(true);
      const compacted = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`) as RuntimeThread;
      const hasContextCompactionItem = await harness.readEventStreamContains(
        thread.id,
        0,
        '"type":"contextCompaction"',
        { format: 'swe' },
      );
      const hasThreadCompacted = await harness.readEventStreamContains(
        thread.id,
        0,
        '"method":"thread/compacted"',
        { format: 'swe' },
      );
      const read = await harness.appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
      const forkedThroughInitialTurn = await harness.appServerRpc('thread/fork', {
        threadId: thread.id,
        lastTurnId: initialTurn.turnId,
        name: 'Forked before compaction',
      });
  
      const compactionSummary = compacted.messages.find((message) => message.contextCompaction);
  
      expect(compactionSummary?.content).toContain('<context_compaction_summary');
      expect(read.thread.turns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'contextCompaction' }),
          ]),
        }),
      ]));
      expect(JSON.stringify(read.thread.turns)).toContain(compactingTurn.turnId);
      expect(JSON.stringify(forkedThroughInitialTurn.thread.turns)).not.toContain('contextCompaction');
      expect(JSON.stringify(forkedThroughInitialTurn.thread.turns)).not.toContain(compactingTurn.turnId);
      expect(hasContextCompactionItem).toBe(true);
      expect(hasThreadCompacted).toBe(true);
    }, longIntegrationTestTimeoutMs);
  
  it('streams manual AppServer compact requests as contextCompaction turns', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Manual AppServer compact' }),
      });
      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Create enough history for manual compact.' }),
      });
      await harness.waitForThread(
        thread.id,
        (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'),
      );
  
      await expect(harness.appServerRpc('thread/compact/start', { threadId: thread.id })).resolves.toEqual({});
  
      const compacted = await harness.waitForThread(
        thread.id,
        (item) => item.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('manual') === true),
      );
      const hasContextCompactionItem = await harness.readEventStreamContains(
        thread.id,
        0,
        '"type":"contextCompaction"',
        { format: 'swe' },
      );
      const read = await harness.appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
  
      const compactionSummary = compacted.messages.find((message) => message.contextCompaction);
  
      expect(compactionSummary?.turnId).toBeTruthy();
      expect(read.thread.turns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: compactionSummary?.turnId,
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'contextCompaction' }),
          ]),
        }),
      ]));
      expect(hasContextCompactionItem).toBe(true);
    }, mediumIntegrationTestTimeoutMs);
  
  it('runs AppServer thread shell commands as userShell commandExecution events', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-swe-shell-project-'));
      const project = await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'AppServer shell project' }),
      });
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'AppServer shell command', projectId: project.id }),
      });
  
      await expect(harness.appServerRpc('thread/shellCommand', {
        threadId: thread.id,
        command: `${nodeCommand()} -e "process.stdout.write('swe shell output\\n')"`,
      })).resolves.toEqual({});
  
      const hasUserShellItem = await harness.readEventStreamContains(
        thread.id,
        0,
        '"source":"userShell"',
        { format: 'swe' },
      );
      const hasOutputDelta = await harness.readEventStreamContains(
        thread.id,
        0,
        '"method":"item/commandExecution/outputDelta"',
        { format: 'swe' },
      );
      const hasRuntimeOutputDelta = await harness.readEventStreamContains(
        thread.id,
        0,
        '"type":"tool.output_delta"',
      );
      const hasUserShellTaskKind = await harness.readEventStreamContains(
        thread.id,
        0,
        '"taskKind":"user_shell"',
      );
      const read = await harness.appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
  
      expect(hasUserShellItem).toBe(true);
      expect(hasOutputDelta).toBe(true);
      expect(hasRuntimeOutputDelta).toBe(true);
      expect(hasUserShellTaskKind).toBe(true);
      expect(read.thread.turns).toEqual([expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            type: 'commandExecution',
            source: 'userShell',
            aggregatedOutput: expect.stringContaining('swe shell output'),
          }),
        ]),
      })]);
    });
  
  it('attaches AppServer thread shell commands to an active turn', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'delayed-provider',
            providers: [
              {
                id: 'delayed-provider',
                name: 'Delayed provider',
                provider: 'openai-compatible',
                baseUrl: capture.baseUrl,
                apiKey: 'sk-delayed',
                enabled: true,
                models: [
                  {
                    id: 'delayed-model',
                    name: 'Delayed model',
                    code: 'delayed-model',
                    enabled: true,
                    maxOutputTokens: 1000,
                    thinkingEnabled: false,
                    thinkingEfforts: [],
                  },
                ],
              },
            ],
          }),
        });
        const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-swe-active-shell-project-'));
        const project = await harness.runtimeFetch('/v1/projects', {
          method: 'POST',
          body: JSON.stringify({ path: projectDir, name: 'Active shell project' }),
        });
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Active shell command', projectId: project.id }),
        });
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: 'Keep this turn active.' }),
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for delayed provider request');
  
        await expect(harness.appServerRpc('thread/shellCommand', {
          threadId: thread.id,
          command: `${nodeCommand()} -e "process.stdout.write('active shell output\\n')"`,
        })).resolves.toEqual({});
  
        const updated = await harness.waitForThread(
          thread.id,
          (item) => item.messages.some((message) =>
            message.turnId === started.turnId
            && message.role === 'tool'
            && message.toolName === 'run_shell_command'
            && message.content.includes('active shell output')
          ),
        );
        const hasUserShellItem = await harness.readEventStreamContains(
          thread.id,
          0,
          '"source":"userShell"',
          { format: 'swe' },
        );
        const read = await harness.appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
        const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === started.turnId);
  
        expect(hasUserShellItem).toBe(true);
        expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'tool')).toHaveLength(1);
        expect(activeTurn?.items).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'commandExecution',
            source: 'userShell',
            aggregatedOutput: expect.stringContaining('active shell output'),
          }),
        ]));
      } finally {
        capture.release();
        await capture.close();
      }
    });
});
