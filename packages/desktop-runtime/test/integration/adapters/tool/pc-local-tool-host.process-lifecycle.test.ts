import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHost, nodeCommand } from './pc-local-tool-host.support.js';

describe('pc local process lifecycle', () => {
  it('does not allow persistent-process stdin to bypass the disk guard', async () => {
    const { host, projectId } = await createHost();
    const context = {
      threadId: 'thread_stdin_guard',
      turnId: 'turn_stdin_guard',
      projectId,
      toolCallId: 'call_stdin_guard',
      permissionProfile: 'danger-full-access' as const,
    };
    const running = await host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "process.stdin.resume(); setInterval(() => {}, 1000)"`,
      risk_level: 'low',
      yield_time_ms: 1,
      persist: true,
      persist_ttl_ms: 5_000,
    }, context);
    const processId = String((running.data as Record<string, unknown>).process_id || '');

    try {
      await expect(host.runTool('write_shell_process', {
        process_id: processId,
        input: 'diskpart\r\n',
      }, context)).rejects.toMatchObject({
        failureKind: 'policy_blocked',
        message: expect.stringContaining('磁盘'),
      });
    } finally {
      await host.runTool('terminate_shell_process', { process_id: processId }, context).catch(() => undefined);
    }
  });

  it('declares an upfront sandbox bypass for restricted shell tools when the provider is unavailable', async () => {
    const { host } = await createHost({
      shellSandboxCapability: () => ({
        supported: false,
        provider: '',
        reason: 'test platform has no sandbox provider',
      }),
    });
    const restrictedContext = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write' as const,
    };

    expect(host.toolRuntimeProfile('exec_command', restrictedContext)).toEqual({
      requiresSandboxBypassApproval: true,
    });
    expect(host.toolRuntimeProfile('run_shell_command', restrictedContext)).toEqual({
      requiresSandboxBypassApproval: true,
    });
    expect(host.toolRuntimeProfile('read_file', restrictedContext)).toBeNull();
    expect(host.toolRuntimeProfile('exec_command', {
      ...restrictedContext,
      permissionProfile: 'danger-full-access',
    })).toBeNull();
  });

  it('cleans non-persisted shell processes for a turn', async () => {
    const { host, projectId } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      projectId,
      toolCallId: 'call_temp',
      permissionProfile: 'danger-full-access' as const,
    };
    const running = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`,
        risk_level: 'low',
        yield_time_ms: 1,
      },
      context,
    );
    const processId = String((running.data as Record<string, unknown>).process_id || '');
    expect(processId).toBeTruthy();

    await host.cleanupTurn?.(context, { status: 'completed' });

    await expect(host.runTool('read_shell_process', { process_id: processId }, context))
      .rejects.toThrow('Shell process not found');
  });

  it('drops per-turn file read state during turn cleanup', async () => {
    const { host, projectDir, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_file_state', projectId };
    await writeFile(path.join(projectDir, 'read-state.txt'), 'state\n', 'utf8');
    await host.runTool('read_file', { file_path: 'read-state.txt' }, context);
    const projectStates = (host as unknown as {
      projectStates: Map<string, { turnFileStates: Map<string, unknown> }>;
    }).projectStates;
    expect([...projectStates.values()][0]?.turnFileStates.size).toBe(1);

    await host.cleanupTurn?.(context, { status: 'completed' });

    expect([...projectStates.values()][0]?.turnFileStates.size).toBe(0);
  });

  it('bounds cached project states and per-project turn file states', async () => {
    const { host, projectDir } = await createHost();
    let latestEnvironment: {
      id: string;
      cwd: string;
      workspaceRoot: string;
      workspaceRoots: string[];
    } | undefined;

    for (let index = 0; index < 36; index += 1) {
      const workspaceRoot = path.join(projectDir, `project-state-${index}`);
      await mkdir(workspaceRoot);
      latestEnvironment = {
        id: `environment_${index}`,
        cwd: workspaceRoot,
        workspaceRoot,
        workspaceRoots: [workspaceRoot],
      };
      await host.previewToolCall('read_file', { file_path: 'unused.txt' }, {
        environment: latestEnvironment,
        threadId: `thread_project_${index}`,
        turnId: 'turn_1',
      });
    }

    const projectStates = (host as unknown as {
      projectStates: Map<string, { turnFileStates: Map<string, unknown> }>;
    }).projectStates;
    expect(projectStates.size).toBe(32);
    expect(projectStates.has(path.resolve(latestEnvironment!.workspaceRoot))).toBe(true);

    for (let index = 0; index < 70; index += 1) {
      await host.previewToolCall('read_file', { file_path: 'unused.txt' }, {
        environment: latestEnvironment,
        threadId: 'thread_turn_cache',
        turnId: `turn_${index}`,
      });
    }
    expect(projectStates.get(path.resolve(latestEnvironment!.workspaceRoot))?.turnFileStates.size).toBe(64);

    await host.shutdown();
  });

  it('preserves explicitly persisted shell processes across turn cleanup', async () => {
    const { host, projectId } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      projectId,
      toolCallId: 'call_persist',
      permissionProfile: 'danger-full-access' as const,
    };
    const running = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`,
        risk_level: 'low',
        yield_time_ms: 1,
        persist: true,
        persist_ttl_ms: 5000,
      },
      context,
    );
    const processId = String((running.data as Record<string, unknown>).process_id || '');
    expect(processId).toBeTruthy();

    try {
      await host.cleanupTurn?.(context, { status: 'completed' });
      const listed = await host.runTool('list_shell_processes', {}, context);
      const processes = (listed.data as { processes?: Array<Record<string, unknown>> }).processes ?? [];
      expect(processes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          process_id: processId,
          persisted: true,
          turn_id: 'turn_1',
          tool_call_id: 'call_persist',
        }),
      ]));
    } finally {
      await host.runTool('terminate_shell_process', { process_id: processId }, context).catch(() => undefined);
    }
  });

  it('lists and terminates persisted shell services within their originating conversation', async () => {
    const { host, projectId } = await createHost();
    const context = {
      threadId: 'thread_services',
      turnId: 'turn_services',
      projectId,
      toolCallId: 'call_service',
      permissionProfile: 'danger-full-access' as const,
    };
    const running = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`,
        risk_level: 'low',
        yield_time_ms: 1,
        persist: true,
        persist_ttl_ms: 5_000,
      },
      context,
    );
    const processId = String((running.data as Record<string, unknown>).process_id || '');

    try {
      await expect(host.listBackgroundShellProcesses(context.threadId)).resolves.toEqual([
        expect.objectContaining({
          id: processId,
          threadId: context.threadId,
          turnId: context.turnId,
          toolCallId: context.toolCallId,
          command: expect.stringContaining('setInterval'),
          directory: '.',
          startedAt: expect.any(String),
          expiresAt: expect.any(String),
        }),
      ]);
      await expect(host.listBackgroundShellProcesses('thread_other')).resolves.toEqual([]);
      await expect(host.listAllBackgroundShellProcesses()).resolves.toEqual([
        expect.objectContaining({ id: processId, threadId: context.threadId }),
      ]);
      await expect(host.terminateBackgroundShellProcess('thread_other', processId)).resolves.toEqual({ terminated: false });
      await expect(host.listBackgroundShellProcesses(context.threadId)).resolves.toHaveLength(1);

      await expect(host.terminateBackgroundShellProcess(context.threadId, processId)).resolves.toEqual({ terminated: true });
      await expect(host.listBackgroundShellProcesses(context.threadId)).resolves.toEqual([]);
    } finally {
      await host.terminateBackgroundShellProcess(context.threadId, processId).catch(() => undefined);
    }
  });
});
