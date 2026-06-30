import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from '../workspace/file-workspace-project-store.js';
import { ShellToolHost } from './shell-tool-host.js';

describe('shell tool host', () => {
  it('runs shell commands inside the active project with a filtered environment', async () => {
    const { host, projectDir } = await createHost();
    const expectedProjectDir = await realpath(projectDir);
    const previousSecret = process.env.SETSUNA_SECRET_TOKEN;
    process.env.SETSUNA_SECRET_TOKEN = 'do-not-leak';

    try {
      const result = await host.runTool(
        'run_shell_command',
        {
          command: `${nodeCommand()} -e "console.log(process.cwd()); console.log(process.env.SETSUNA_SECRET_TOKEN || 'missing')"`,
          risk_level: 'low',
          yield_time_ms: 0,
        },
        context(),
      );

      expect(normalizePathText(result.content)).toContain(normalizePathText(expectedProjectDir));
      expect(result.content).toContain('missing');
      expect(result.content).not.toContain('do-not-leak');
    } finally {
      if (previousSecret === undefined) delete process.env.SETSUNA_SECRET_TOKEN;
      else process.env.SETSUNA_SECRET_TOKEN = previousSecret;
    }
  });

  it('requires approval for high-risk or unclassified shell commands', async () => {
    const { host } = await createHost();

    const highRisk = await host.approvalForTool?.('run_shell_command', { command: 'rm -rf dist', risk_level: 'high' }, context());
    const suspiciousLowRisk = await host.approvalForTool?.('run_shell_command', { command: 'git reset --hard', risk_level: 'low' }, context());
    const lowRisk = await host.approvalForTool?.('run_shell_command', { command: 'pnpm test', risk_level: 'low' }, context());

    expect(highRisk?.reason).toContain('High-risk');
    expect(suspiciousLowRisk?.reason).toContain('Unclassified');
    expect(lowRisk).toBeNull();
  });

  it('keeps persisted commands readable until terminated', async () => {
    const { host } = await createHost();
    const run = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "setTimeout(() => console.log('persisted output'), 40)"`,
        risk_level: 'low',
        yield_time_ms: 1,
        persist: true,
        persist_ttl_ms: 2000,
      },
      context(),
    );
    const processId = (run.data as { process_id: string }).process_id;

    const read = await host.runTool('read_shell_process', { process_id: processId, wait_ms: 500 }, context());
    const listed = await host.runTool('list_shell_processes', {}, context());

    expect(run.content).toContain('Process is still running');
    expect(read.content).toContain('persisted output');
    expect(listed.content).toContain(processId);
  });

  it('terminates foreground commands when the turn signal aborts', async () => {
    const { host } = await createHost();
    const controller = new AbortController();
    const abortError = new Error('test cancellation');
    abortError.name = 'AbortError';
    setTimeout(() => controller.abort(abortError), 30);

    const result = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "setTimeout(() => console.log('late output'), 5000)"`,
        risk_level: 'low',
        yield_time_ms: 30_000,
      },
      { ...context(), signal: controller.signal },
    );

    expect(result.content).toContain('exit: cancelled');
    expect(result.data).toMatchObject({ aborted: true, running: false });
  });

  it('blocks shell cwd escapes outside the project', async () => {
    const { host } = await createHost();

    await expect(
      host.runTool(
        'run_shell_command',
        {
          command: 'pwd',
          directory: '..',
          risk_level: 'low',
          yield_time_ms: 0,
        },
        context(),
      ),
    ).rejects.toThrow('escapes the project workspace');
  });

  it('allows shell cwd outside the project with full access permission', async () => {
    const { host, projectDir } = await createHost();
    const parentDir = path.dirname(projectDir);

    const result = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "console.log(process.cwd())"`,
        directory: parentDir,
        risk_level: 'low',
        yield_time_ms: 0,
      },
      { ...context(), permissionProfile: 'danger-full-access' },
    );

    expect(normalizePathText(result.content)).toContain(normalizePathText(await realpath(parentDir)));
  }, 20_000);
});

async function createHost() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-shell-tool-test-'));
  const projectDir = path.join(root, 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(projectDir, { recursive: true });
  const store = new FileWorkspaceProjectStore(dataDir, systemClock);
  await store.addProject({ path: projectDir });
  return { host: new ShellToolHost(store), projectDir };
}

function context() {
  return { threadId: 'thread_1', turnId: 'turn_1' };
}

function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}

function normalizePathText(value: string): string {
  return process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
}
