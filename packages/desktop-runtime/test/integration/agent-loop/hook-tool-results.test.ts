import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  APPLY_PATCH_TOOL,
  RUN_SHELL_COMMAND_TOOL,
} from '../../support/agent-loop/hook-tool-results.js';
import {
  CapturingToolHost,
  HooksConfigStore,
  mkDataDir,
  nodeEvalHook,
  SingleToolCallModelClient,
  ToolCallingModelClient
} from '../../support/agent-loop/shared.js';

describe('agent loop tool hook results', () => {
  it('allows PreToolUse hooks to rewrite tool input before execution', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook rewrite', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { path: 'REWRITTEN.md' } } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'REWRITTEN.md' }, projectId: 'project_1' }]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'workspace_read_file',
          argumentsPreview: expect.stringContaining('REWRITTEN.md'),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PreToolUse',
          toolName: 'workspace_read_file',
          status: 'completed',
          message: 'Updated tool input.',
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
        { eventName: 'PreToolUse', status: 'completed', message: 'Updated tool input.' },
      ]);
    });
  
  it('normalizes shell PreToolUse payload as Bash and preserves local args when rewriting', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Bash hook rewrite', projectId: 'project_1' });
      const modelClient = new SingleToolCallModelClient({
        id: 'call_shell_hook',
        name: 'run_shell_command',
        arguments: '{"command":"printf original","risk_level":"low","directory":"scripts"}',
      });
      const toolHost = new CapturingToolHost([RUN_SHELL_COMMAND_TOOL]);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.tool_name !== 'Bash' || payload.tool_input?.command !== 'printf original' || payload.tool_use_id !== 'call_shell_hook') { process.stderr.write(JSON.stringify(payload)); process.exit(1); } process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: 'printf rewritten' } } })); });"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'run shell' });
      const saved = await threadStore.getThread(thread.id);
  
      expect(toolHost.calls).toEqual([{
        name: 'run_shell_command',
        input: { command: 'printf rewritten', risk_level: 'low', directory: 'scripts' },
        projectId: 'project_1',
      }]);
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'run_shell_command')?.hookRuns).toMatchObject([
        { eventName: 'PreToolUse', matcher: 'Bash', status: 'completed', message: 'Updated tool input.' },
      ]);
    });
  
  it('normalizes apply_patch hook payload to Codex command shape and rewrites patch only', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Apply patch hook rewrite', projectId: 'project_1' });
      const originalPatch = '*** Begin Patch\n*** Add File: old.txt\n+old\n*** End Patch';
      const rewrittenPatch = '*** Begin Patch\n*** Add File: new.txt\n+new\n*** End Patch';
      const hookCommand = nodeEvalHook(`const originalPatch = ${JSON.stringify(originalPatch)}; const rewrittenPatch = ${JSON.stringify(rewrittenPatch)}; let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.tool_name !== 'apply_patch' || payload.tool_input?.command !== originalPatch || payload.tool_use_id !== 'call_patch_hook') { process.stderr.write(JSON.stringify(payload)); process.exit(1); } process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: rewrittenPatch } } })); });`);
      const modelClient = new SingleToolCallModelClient({
        id: 'call_patch_hook',
        name: 'apply_patch',
        arguments: JSON.stringify({ patch: originalPatch, workdir: 'src' }),
      });
      const toolHost = new CapturingToolHost([APPLY_PATCH_TOOL]);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'apply_patch',
            hooks: [{
              type: 'command',
              command: hookCommand,
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'apply patch' });
      const saved = await threadStore.getThread(thread.id);
  
      expect(toolHost.calls).toEqual([{
        name: 'apply_patch',
        input: { patch: rewrittenPatch, workdir: 'src' },
        projectId: 'project_1',
      }]);
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'apply_patch')?.hookRuns).toMatchObject([
        { eventName: 'PreToolUse', matcher: 'apply_patch', status: 'completed', message: 'Updated tool input.' },
      ]);
    });
  
  it('marks invalid PreToolUse hook output as failed and ignores rewrites', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook invalid rewrite', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { path: 'INVALID.md' } } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PreToolUse',
          toolName: 'workspace_read_file',
          status: 'failed',
          message: 'PreToolUse hook returned updatedInput without permissionDecision:allow',
          entries: [{ kind: 'error', text: 'PreToolUse hook returned updatedInput without permissionDecision:allow' }],
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
        { eventName: 'PreToolUse', status: 'failed', message: 'PreToolUse hook returned updatedInput without permissionDecision:allow', entries: [{ kind: 'error', text: 'PreToolUse hook returned updatedInput without permissionDecision:allow' }] },
      ]);
    });
  
  it('runs PostToolUse hooks and returns feedback to the model', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook post feedback', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PostToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ decision: 'block', reason: 'review the tool result first' }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const toolMessage = modelClient.requests[1].messages.find((message) => message.role === 'tool');
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toHaveLength(1);
      expect(toolMessage?.content).toContain('review the tool result first');
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'workspace_read_file',
          status: 'success',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PostToolUse',
          toolName: 'workspace_read_file',
          status: 'blocked',
          message: 'review the tool result first',
          entries: [{ kind: 'feedback', text: 'review the tool result first' }],
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
        { eventName: 'PostToolUse', status: 'blocked', message: 'review the tool result first', entries: [{ kind: 'feedback', text: 'review the tool result first' }] },
      ]);
    });
  
  it('adds non-blocking PostToolUse context to the model while retaining the UI warning', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook post context', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new CapturingToolHost(),
        configStore: new HooksConfigStore({
          PostToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ systemMessage: 'review warning', hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'ask the user to review the diff' } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const toolMessage = modelClient.requests[1].messages.find((message) => message.role === 'tool');
  
      expect(toolMessage?.content).toContain('<hook_additional_context>');
      expect(toolMessage?.content).toContain('ask the user to review the diff');
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([{
        eventName: 'PostToolUse',
        status: 'completed',
        message: 'Added context.',
        entries: [
          { kind: 'warning', text: 'review warning' },
          { kind: 'context', text: 'ask the user to review the diff' },
        ],
      }]);
    });
  
  it('marks PostToolUse continue false hooks as stopped and returns feedback', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook post stop', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PostToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'stop after tool', reason: 'model-facing stop feedback' }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const toolMessage = modelClient.requests[1].messages.find((message) => message.role === 'tool');
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toHaveLength(1);
      expect(toolMessage?.content).toContain('model-facing stop feedback');
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PostToolUse',
          toolName: 'workspace_read_file',
          status: 'stopped',
          message: 'model-facing stop feedback',
          entries: [{ kind: 'stop', text: 'model-facing stop feedback' }],
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
        { eventName: 'PostToolUse', status: 'stopped', message: 'model-facing stop feedback', entries: [{ kind: 'stop', text: 'model-facing stop feedback' }] },
      ]);
    });
});
