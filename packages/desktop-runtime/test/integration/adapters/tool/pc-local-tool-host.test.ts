import type {
  RuntimeExecPolicyAmendment,
  RuntimeNetworkPolicyAmendment,
  RuntimeWorkspaceDependenciesStatus,
} from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../../../src/adapters/store/file-config-store.js';
import { PcLocalToolHost } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { shellCommandHiddenBySandbox } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-process.js';
import {
  createShellSandboxExecutionPlan,
  shellSandboxCapability,
  shellSandboxProfile,
  shellSandboxUnavailableReason,
} from '../../../../src/adapters/tool/pc-local/pc-local-tools.js';
import { FileWorkspaceProjectStore } from '../../../../src/adapters/workspace/file-workspace-project-store.js';
import {
  ManagedWorkspaceDependencyManager,
} from '../../../../src/adapters/workspace/managed-workspace-dependency-manager.js';
import { systemClock } from '../../../../src/ports/clock.js';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../../../../src/ports/policy-amendment-store.js';
import { ToolExecutionError } from '../../../../src/ports/tool-host.js';
import type { WorkspaceDependencyManager } from '../../../../src/ports/workspace-dependency-manager.js';

const execFileAsync = promisify(execFile);
const restrictedShellExecutionUnavailable = Boolean(shellSandboxUnavailableReason({
  osSandbox: true,
  permissionProfile: 'workspace-write',
}));

describe('pc local tool host', () => {
  it('exposes the pc SWE tool contract and writes files directly', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const tools = await host.listTools(context);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'apply_patch',
      'write_file',
      'append_file',
      'delete_file',
      'edit',
      'read_file',
      'read_diff',
      'git_status',
      'git_log',
      'git_show',
      'run_shell_command',
      'request_permissions',
      'exec_command',
      'write_stdin',
    ]));
    expect(tools.map((tool) => tool.name)).not.toContain('workspace_write_file');
    expect(tools.map((tool) => tool.name)).not.toContain('remember_memory');
    expect(tools.map((tool) => tool.name)).not.toContain('configure_mcp_server');
    const execTool = tools.find((tool) => tool.name === 'exec_command');
    expect((execTool?.inputSchema?.properties as Record<string, unknown>)?.sandbox_permissions).toMatchObject({
      enum: expect.arrayContaining(['with_additional_permissions', 'require_escalated']),
    });
    expect((execTool?.inputSchema?.properties as Record<string, unknown>)?.persist).toMatchObject({ type: 'boolean' });

    await expect(host.approvalForTool('write_file', { file_path: 'src/generated.txt', content: 'generated\n' }, context))
      .resolves.toBeNull();
    await expect(host.approvalForTool('delete_file', { file_path: 'src/generated.txt' }, context))
      .resolves.toBeNull();
    const written = await host.runTool('write_file', { file_path: 'src/generated.txt', content: 'generated\n' }, context);

    expect(JSON.parse(written.preview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/generated.txt',
        action: 'Created',
        additions: 1,
        deletions: 0,
      },
    });
    await expect(readFile(path.join(projectDir, 'src', 'generated.txt'), 'utf8')).resolves.toBe('generated\n');
  });

  it('keeps built-in Git output scoped and relative to a selected repository subdirectory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-pc-git-paths-'));
    const repositoryRoot = path.join(root, 'repo');
    const projectDir = path.join(repositoryRoot, 'packages', 'app');
    await mkdir(projectDir, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'outside.txt'), 'outside before\n');
    await writeFile(path.join(projectDir, 'inside.txt'), 'inside before\n');
    await execFileAsync('git', ['add', '.'], { cwd: repositoryRoot });
    await execFileAsync('git', ['-c', 'user.name=Setsuna Test', '-c', 'user.email=setsuna@example.com', 'commit', '-m', 'initial workspace commit'], { cwd: repositoryRoot });
    const initialRevision = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
    await writeFile(path.join(repositoryRoot, 'outside.txt'), 'outside committed\n');
    await execFileAsync('git', ['add', 'outside.txt'], { cwd: repositoryRoot });
    await execFileAsync('git', ['-c', 'user.name=Setsuna Test', '-c', 'user.email=setsuna@example.com', 'commit', '-m', 'outside-only commit'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'outside.txt'), 'outside after\n');
    await writeFile(path.join(projectDir, 'inside.txt'), 'inside after\n');

    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
    const project = await store.addProject({ path: projectDir });
    const host = new PcLocalToolHost(store);
    const environment = await host.environmentForToolContext({ threadId: 'thread_1', projectId: project.id });
    const context = { environment, threadId: 'thread_1', turnId: 'turn_1', projectId: project.id };

    const status = await host.runTool('git_status', {}, context);
    const diff = await host.runTool('read_diff', {}, context);
    const log = await host.runTool('git_log', { max_count: 5 }, context);
    const show = await host.runTool('git_show', { revision: initialRevision }, context);
    const canonicalRepositoryRoot = await realpath(repositoryRoot);

    expect(environment.repository).toMatchObject({
      root: canonicalRepositoryRoot,
      workspacePrefix: 'packages/app',
    });
    expect(status.content).toContain('inside.txt');
    expect(status.content).not.toContain('outside.txt');
    expect(status.content).not.toContain('packages/app/inside.txt');
    expect(diff.content).toContain('diff --git a/inside.txt b/inside.txt');
    expect(diff.content).not.toContain('outside.txt');
    expect(diff.content).not.toContain('a/packages/app/inside.txt');
    expect(log.content).toContain('initial workspace commit');
    expect(log.content).not.toContain('outside-only commit');
    expect(show.content).toContain('diff --git a/inside.txt b/inside.txt');
    expect(show.content).not.toContain('outside.txt');
    expect(show.content).not.toContain('a/packages/app/inside.txt');
  });

  it('hides request_permissions when the feature is disabled', async () => {
    const { host } = await createHost();

    const enabledTools = await host.listTools({
      threadId: 'thread_1',
      turnId: 'turn_1',
      features: { request_permissions_tool: true },
    });
    const disabledTools = await host.listTools({
      threadId: 'thread_1',
      turnId: 'turn_1',
      features: { request_permissions_tool: false },
    });

    expect(enabledTools.map((tool) => tool.name)).toContain('request_permissions');
    expect(disabledTools.map((tool) => tool.name)).not.toContain('request_permissions');
    expect(disabledTools.map((tool) => tool.name)).toContain('exec_command');
  });

  it('accepts path aliases for direct file tools before executing pc local tools', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await mkdir(path.join(projectDir, 'src'), { recursive: true });
    await writeFile(path.join(projectDir, 'src', 'existing.txt'), 'old\n', 'utf8');

    const read = await host.runTool('read_file', { path: 'src/existing.txt' }, context);
    expect(read.content).toContain('old');

    await host.runTool('write_file', { path: 'src/path-alias.txt', content: 'created through path\n' }, context);

    await expect(readFile(path.join(projectDir, 'src', 'path-alias.txt'), 'utf8'))
      .resolves.toBe('created through path\n');
  });

  it('builds streaming write previews when partial tool arguments use path aliases', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const preview = await host.previewPartialToolCall?.(
      'write_file',
      '{"path":"src/stream-path.txt","content":"one\\ntwo\\n"',
      context,
    );

    expect(preview?.resultPreview).toContain('src/stream-path.txt');
    expect(JSON.parse(preview?.resultPreview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/stream-path.txt',
        additions: 2,
        deletions: 0,
      },
    });
  });

  it('builds streaming apply_patch previews with running change counts', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const preview = await host.previewPartialToolCall?.(
      'apply_patch',
      '{"patch":"*** Begin Patch\\n*** Update File: src/index.css\\n@@\\n-body { color: red; }\\n+body { color: blue; }\\n+.app { display: grid; }',
      context,
    );

    expect(JSON.parse(preview?.resultPreview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/index.css',
        additions: 2,
        deletions: 1,
        partial: true,
      },
    });
  });

  it('accepts apply_patch directly', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await mkdir(path.join(projectDir, 'src'), { recursive: true });
    await writeFile(path.join(projectDir, 'src', 'index.css'), 'body { color: red; }\n', 'utf8');

    const patched = await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/index.css',
        '@@',
        '-body { color: red; }',
        '+body { color: blue; }',
        '*** End Patch',
      ].join('\n'),
    }, context);

    expect(JSON.parse(patched.preview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/index.css',
        action: 'Edited',
      },
    });
    await expect(readFile(path.join(projectDir, 'src', 'index.css'), 'utf8'))
      .resolves.toBe('body { color: blue; }\n');
  });

  it('accepts multi-file apply_patch calls', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await mkdir(path.join(projectDir, 'src'), { recursive: true });
    await writeFile(path.join(projectDir, 'src', 'index.css'), 'body { color: red; }\n', 'utf8');

    const patched = await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/index.css',
        '@@',
        '-body { color: red; }',
        '+body { color: blue; }',
        '*** Add File: src/extra.css',
        '+.extra { color: green; }',
        '*** End Patch',
      ].join('\n'),
    }, context);

    expect(JSON.parse(patched.preview ?? '{}')).toMatchObject({
      diff: {
        diffs: [
          { path: 'src/index.css', action: 'Edited' },
          { path: 'src/extra.css', action: 'Created' },
        ],
      },
    });
    await expect(readFile(path.join(projectDir, 'src', 'index.css'), 'utf8'))
      .resolves.toBe('body { color: blue; }\n');
    await expect(readFile(path.join(projectDir, 'src', 'extra.css'), 'utf8'))
      .resolves.toBe('.extra { color: green; }\n');
  });

  it.skipIf(process.platform === 'win32')('does not partially apply a patch when a later target cannot be staged', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await writeFile(path.join(projectDir, 'first.txt'), 'before\n', 'utf8');
    const lockedDirectory = path.join(projectDir, 'locked');
    await mkdir(lockedDirectory);
    await chmod(lockedDirectory, 0o500);

    try {
      await expect(host.runTool('apply_patch', {
        patch: [
          '*** Begin Patch',
          '*** Update File: first.txt',
          '@@',
          '-before',
          '+after',
          '*** Add File: locked/second.txt',
          '+must not exist',
          '*** End Patch',
        ].join('\n'),
      }, context)).rejects.toThrow('EACCES');
    } finally {
      await chmod(lockedDirectory, 0o700);
    }

    await expect(readFile(path.join(projectDir, 'first.txt'), 'utf8')).resolves.toBe('before\n');
  });

  it.skipIf(process.platform === 'win32')('keeps a move source intact when the destination cannot be staged', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await writeFile(path.join(projectDir, 'source.txt'), 'before\n', 'utf8');
    const lockedDirectory = path.join(projectDir, 'locked');
    await mkdir(lockedDirectory);
    await chmod(lockedDirectory, 0o500);

    try {
      await expect(host.runTool('apply_patch', {
        patch: [
          '*** Begin Patch',
          '*** Update File: source.txt',
          '*** Move to: locked/destination.txt',
          '@@',
          '-before',
          '+after',
          '*** End Patch',
        ].join('\n'),
      }, context)).rejects.toThrow('EACCES');
    } finally {
      await chmod(lockedDirectory, 0o700);
    }

    await expect(readFile(path.join(projectDir, 'source.txt'), 'utf8')).resolves.toBe('before\n');
  });

  it('uses pc shell risk classification for approval', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.approvalForTool('run_shell_command', { command: 'pnpm test', risk_level: 'low' }, context))
      .resolves.toBeNull();
    await expect(host.approvalForTool('run_shell_command', { command: 'rm -rf dist', risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('删除') });
    await expect(host.approvalForTool('run_shell_command', { command: shellApplyPatchCommand('src/generated.txt'), risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('apply_patch') });
    await expect(host.approvalForTool('run_shell_command', { command: 'uv pip install fpdf2', risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('依赖') });
    await expect(host.approvalForTool('run_shell_command', { command: 'pip3 install markdown', risk_level: 'low' }, context))
      .resolves.toMatchObject({ reason: expect.stringContaining('依赖') });
  });

  it.skipIf(process.platform === 'win32')('surfaces a failed pipeline stage instead of reporting the trailing command as success', async () => {
    const { host } = await createHost();

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "process.exit(9)" 2>&1 | tail -5`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access',
    })).rejects.toThrow(/(?:Exit Code:\s*9|command exited 9)/u);
  });

  it('allows harmless output redirection to /dev/null under workspace-write', async () => {
    const { host } = await createHost();

    const execution = host.runTool('run_shell_command', {
      command: 'printf ok > /dev/null',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
    });
    if (restrictedShellExecutionUnavailable) {
      await expectRestrictedShellUnavailable(execution);
      return;
    }
    await expect(execution).resolves.toMatchObject({ content: expect.stringContaining('Exit Code: 0') });
  });

  it('blocks shell apply_patch commands that were not intercepted by the runtime orchestrator', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: shellApplyPatchCommand('src/generated.txt'),
      risk_level: 'low',
    }, context)).rejects.toThrow('Shell apply_patch commands must be routed');
  });

  it('blocks shell applypatch alias commands that were not intercepted by the runtime orchestrator', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: shellApplyPatchCommand('src/generated.txt').replace('apply_patch', 'applypatch'),
      risk_level: 'low',
    }, context)).rejects.toThrow('Shell apply_patch commands must be routed');
  });

  it('accepts EOF-heredoc wrapped apply_patch arguments', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await host.runTool('apply_patch', {
      patch: [
        "<<'EOF'",
        '*** Begin Patch',
        '*** Add File: src/heredoc-arg.txt',
        '+ok',
        '*** End Patch',
        'EOF',
      ].join('\n'),
    }, context);

    await expect(readFile(path.join(projectDir, 'src', 'heredoc-arg.txt'), 'utf8')).resolves.toBe('ok\n');
  });

  it('rejects non-EOF heredoc wrappers for direct apply_patch arguments', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('apply_patch', {
      patch: [
        "<<'PATCH'",
        '*** Begin Patch',
        '*** Add File: src/heredoc-arg.txt',
        '+nope',
        '*** End Patch',
        'PATCH',
      ].join('\n'),
    }, context)).rejects.toThrow('apply_patch 补丁必须以');
  });

  it('accepts apply_patch environment preambles for the active local environment', async () => {
    const { host, projectDir, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        `*** Environment ID: ${projectId}`,
        '*** Add File: src/env-patch.txt',
        '+ok',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(path.join(projectDir, 'src', 'env-patch.txt'), 'utf8')).resolves.toBe('ok\n');
  });

  it('rejects apply_patch environment preambles for non-active environments', async () => {
    const { host, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Environment ID: remote',
        '*** Add File: src/env-patch.txt',
        '+nope',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('does not match active environment');
  });

  it('checks protected metadata paths through apply_patch workdir', async () => {
    const { host, projectId } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1', projectId };

    await expect(host.runTool('apply_patch', {
      workdir: '.git',
      patch: [
        '*** Begin Patch',
        '*** Add File: config',
        '+unsafe',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('blocks direct file mutations against protected workspace metadata', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: .git/config',
        '+unsafe',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('blocks protected metadata aliases and case variants', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await mkdir(path.join(projectDir, '.git'), { recursive: true });
    await writeFile(path.join(projectDir, '.git', 'config'), 'safe\n', 'utf8');
    await symlink('.git', path.join(projectDir, 'metadata-alias'));

    await expect(host.runTool('write_file', {
      file_path: 'metadata-alias/config',
      content: 'unsafe\n',
    }, context)).rejects.toThrow('受保护的工作区元数据');
    await expect(host.runTool('write_file', {
      file_path: '.GIT/config',
      content: 'unsafe\n',
    }, context)).rejects.toThrow('受保护的工作区元数据');
    await expect(host.runTool('run_shell_command', {
      command: 'rm metadata-alias/config',
      risk_level: 'low',
      yield_time_ms: 0,
    }, context)).rejects.toThrow('受保护的工作区元数据');
    await expect(readFile(path.join(projectDir, '.git', 'config'), 'utf8')).resolves.toBe('safe\n');
  });

  it('allows writes through a symbolic link whose target stays inside the workspace', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const targetDirectory = path.join(projectDir, 'real-directory');
    const linkedDirectory = path.join(projectDir, 'linked-directory');
    await mkdir(targetDirectory);
    await symlink(
      targetDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await host.runTool('write_file', {
      file_path: 'linked-directory/created.txt',
      content: 'created through link\n',
    }, context);

    await expect(readFile(path.join(targetDirectory, 'created.txt'), 'utf8'))
      .resolves.toBe('created through link\n');
  });

  it('deletes a symbolic link without deleting its target', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await writeFile(path.join(projectDir, 'important.txt'), 'keep\n', 'utf8');
    await symlink('important.txt', path.join(projectDir, 'link.txt'));

    await host.runTool('delete_file', { file_path: 'link.txt' }, context);

    await expect(lstat(path.join(projectDir, 'link.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(projectDir, 'important.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('rejects execution when a file changed after its approved preview', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const target = path.join(projectDir, 'preview.txt');
    await writeFile(target, 'approved base\n', 'utf8');
    const input = { file_path: 'preview.txt', content: 'approved result\n' };
    const preview = await host.previewToolCall('write_file', input, context);
    expect(preview?.integrityToken).toBeTruthy();
    await writeFile(target, 'new editor content\n', 'utf8');

    await expect(host.runTool('write_file', input, {
      ...context,
      expectedPreviewIntegrityToken: preview?.integrityToken,
    })).rejects.toMatchObject({ failureKind: 'preview_changed' });
    await expect(readFile(target, 'utf8')).resolves.toBe('new editor content\n');
  });

  it.skipIf(process.platform === 'win32')('rejects a directory symlink swap after preview without writing outside the workspace', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const sourceDirectory = path.join(projectDir, 'source');
    const movedDirectory = path.join(projectDir, 'source-original');
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'setsuna-preview-outside-'));
    await mkdir(sourceDirectory);
    await writeFile(path.join(sourceDirectory, 'target.txt'), 'workspace content\n', 'utf8');
    await writeFile(path.join(outsideDirectory, 'target.txt'), 'outside content\n', 'utf8');
    const input = { file_path: 'source/target.txt', content: 'approved result\n' };
    const preview = await host.previewToolCall('write_file', input, context);

    try {
      await rename(sourceDirectory, movedDirectory);
      await symlink(outsideDirectory, sourceDirectory);
      await expect(host.runTool('write_file', input, {
        ...context,
        expectedPreviewIntegrityToken: preview?.integrityToken,
      })).rejects.toThrow(/symbolic link|路径不在当前工作区内/u);
      await expect(readFile(path.join(outsideDirectory, 'target.txt'), 'utf8')).resolves.toBe('outside content\n');
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it('blocks shell mutations against protected workspace metadata', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.runTool('run_shell_command', {
      command: 'rm .git/config',
      risk_level: 'low',
      yield_time_ms: 0,
    }, context)).rejects.toThrow('受保护的工作区元数据');
  });

  it('allows shell writes under configured workspace-write writable roots', async () => {
    const { host } = await createHost();
    const writableRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-extra-writable-root-'));
    const target = path.join(writableRoot, 'allowed.txt');
    const command = `printf ok > ${JSON.stringify(target)}`;

    await expect(host.runTool('run_shell_command', {
      command,
      risk_level: 'low',
      yield_time_ms: 0,
    }, { threadId: 'thread_1', turnId: 'turn_1' })).rejects.toThrow('未授权路径');

    const execution = host.runTool('run_shell_command', {
      command,
      directory: writableRoot,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { writableRoots: [writableRoot] },
    });
    if (restrictedShellExecutionUnavailable) {
      await expectRestrictedShellUnavailable(execution);
      await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }

    const result = await execution;
    expect(result.content).toContain('Exit Code: 0');
    await expect(readFile(target, 'utf8')).resolves.toBe('ok');
  });

  it('copies quoted and escaped paths into a workspace whose path contains spaces', async () => {
    const { host, projectDir } = await createHost({ projectDirName: 'temporary workspace' });
    const workspaceRoot = await realpath(projectDir);
    const readableRoot = path.join(path.dirname(workspaceRoot), 'attachment files');
    const source = path.join(readableRoot, 'ticket source.pdf');
    const targetDir = path.join(workspaceRoot, 'tmp', 'pdfs');
    const target = path.join(targetDir, 'ticket.pdf');
    const escapedTarget = target.replaceAll(' ', '\\ ');
    await mkdir(readableRoot, { recursive: true });
    await writeFile(source, 'pdf payload', 'utf8');

    const execution = host.runTool('exec_command', {
      cmd: `mkdir -p ${JSON.stringify(targetDir)} && cp ${JSON.stringify(source)} ${escapedTarget}`,
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { readableRoots: [readableRoot] },
    });
    if (restrictedShellExecutionUnavailable) {
      await expectRestrictedShellUnavailable(execution);
      await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }

    const result = await execution;
    expect(result.content).toContain('Exit Code: 0');
    await expect(readFile(target, 'utf8')).resolves.toBe('pdf payload');
  });

  it('still blocks cp target-directory options outside workspace-write roots', async () => {
    const { host, projectDir } = await createHost();
    const source = path.join(projectDir, 'source.txt');
    const outsideTarget = await mkdtemp(path.join(tmpdir(), 'setsuna-cp-target-'));
    await writeFile(source, 'payload', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: `cp --target-directory ${JSON.stringify(outsideTarget)} ${JSON.stringify(source)}`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
    })).rejects.toThrow('未授权路径');
  });

  it('still blocks cp destinations outside workspace-write roots when stderr is redirected', async () => {
    const { host, projectDir } = await createHost();
    const source = path.join(projectDir, 'source.txt');
    const outsideTarget = path.join(await mkdtemp(path.join(tmpdir(), 'setsuna-cp-redirect-target-')), 'copied.txt');
    await writeFile(source, 'payload', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: `cp ${JSON.stringify(source)} ${JSON.stringify(outsideTarget)} 2>/dev/null`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
    })).rejects.toThrow('未授权路径');
  });

  it('still blocks quoted outside paths embedded in inline scripts', async () => {
    const { host } = await createHost();
    const outsideTarget = path.join(await mkdtemp(path.join(tmpdir(), 'setsuna-inline-target-')), 'script output.txt');
    const script = `from pathlib import Path; Path(${JSON.stringify(outsideTarget)}).write_text('payload')`;

    await expect(host.runTool('run_shell_command', {
      command: `python3 -c ${JSON.stringify(script)}`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
    })).rejects.toThrow('未授权路径');
  });

  it('allows reads under configured readable roots', async () => {
    const { host } = await createHost();
    const readableRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-readable-root-'));
    const target = path.join(readableRoot, 'allowed.txt');
    await writeFile(target, 'outside but approved\n', 'utf8');

    await expect(host.runTool('read_file', { file_path: target }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: {},
    })).rejects.toThrow('readable_roots');

    const result = await host.runTool('read_file', { file_path: target }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { readableRoots: [readableRoot] },
    });

    expect(result.content).toContain('outside but approved');
  });

  it('denies file tool access under configured denied roots', async () => {
    const { host, projectDir } = await createHost();
    const deniedRoot = path.join(projectDir, 'blocked');
    await mkdir(deniedRoot, { recursive: true });
    await writeFile(path.join(deniedRoot, 'secret.txt'), 'blocked\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedRoots: [deniedRoot] },
    };

    await expect(host.runTool('read_file', { file_path: 'blocked/secret.txt' }, context))
      .rejects.toThrow('deny');
    await expect(host.runTool('list_directory', { path: 'blocked' }, context))
      .rejects.toThrow('deny');

    await expect(host.runTool('write_file', { file_path: 'blocked/generated.txt', content: 'nope\n' }, context))
      .rejects.toThrow('deny');
  });

  it('normalizes configured denied roots that use Windows separators', async () => {
    const { host, projectDir } = await createHost();
    await mkdir(path.join(projectDir, 'blocked', 'nested'), { recursive: true });
    await writeFile(path.join(projectDir, 'blocked', 'nested', 'secret.txt'), 'blocked\n', 'utf8');

    await expect(host.runTool('read_file', { file_path: 'blocked/nested/secret.txt' }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedRoots: ['blocked\\nested'] },
    })).rejects.toThrow('deny');
  });

  it('denies file reads and searches matching configured denied glob patterns', async () => {
    const { host, projectDir } = await createHost();
    await mkdir(path.join(projectDir, 'app'), { recursive: true });
    await writeFile(path.join(projectDir, '.env'), 'ROOT_SECRET=1\n', 'utf8');
    await writeFile(path.join(projectDir, 'app', '.env'), 'APP_SECRET=1\n', 'utf8');
    await writeFile(path.join(projectDir, 'app', 'notes.txt'), 'visible\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedGlobPatterns: [path.join(projectDir, '**/*.env')] },
    };

    await expect(host.runTool('read_file', { file_path: '.env' }, context))
      .rejects.toThrow('deny');

    const search = await host.runTool('search_text', { query: 'SECRET' }, context);
    expect(search.content).not.toContain('ROOT_SECRET');
    expect(search.content).not.toContain('APP_SECRET');
  });

  it('treats search_text queries as regex by default and preserves an explicit literal mode', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, 'symbols.ts'), [
      'const historyTrip = true',
      'const HistoryTrip = false',
      "const literal = 'a|b'",
      '',
    ].join('\n'));
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const regexSearch = await host.runTool('search_text', {
      query: 'history_trip|HistoryTrip|historyTrip',
      max_results: 30,
    }, context);
    const literalSearch = await host.runTool('search_text', {
      query: 'a|b',
      regex: false,
    }, context);

    expect(regexSearch.content).toContain('regex "history_trip|HistoryTrip|historyTrip"');
    expect(regexSearch.content).toContain('symbols.ts:1:');
    expect(regexSearch.content).toContain('symbols.ts:2:');
    expect(literalSearch.content).not.toContain('regex "a|b"');
    expect(literalSearch.content).toContain("const literal = 'a|b'");
  });

  it('denies shell writes under configured denied roots', async () => {
    const { host, projectDir } = await createHost();
    const deniedRoot = path.join(projectDir, 'blocked');
    await mkdir(deniedRoot, { recursive: true });

    await expect(host.runTool('run_shell_command', {
      command: 'printf nope > blocked/generated.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedRoots: [deniedRoot] },
    })).rejects.toThrow('deny');
  });

  it('denies shell reads matching configured denied glob patterns', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, '.env'), 'SECRET=1\n', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: 'cat .env',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { deniedGlobPatterns: [path.join(projectDir, '**/*.env')] },
    })).rejects.toThrow('deny');
  });

  it('uses persisted exec policy amendments as local shell allow rules', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [['git', 'status']],
        networkPolicyAmendments: [],
      }),
    });

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status --short',
      sandbox_permissions: 'require_escalated',
      justification: 'normally high risk',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toBeNull();

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status --short; touch owned.txt',
      sandbox_permissions: 'require_escalated',
      justification: 'compound command must not reuse the prefix',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.any(String),
    });

    await expect(host.approvalForTool('exec_command', {
      cmd: 'git status\ntouch owned.txt',
      sandbox_permissions: 'require_escalated',
      justification: 'newline-separated command must not reuse the prefix',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      reason: expect.any(String),
    });
  });

  it('uses persisted network deny amendments during shell preflight', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'example.com', action: 'deny' }],
      }),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toThrow('network policy');
  });

  it('does not treat a persisted host allow as process-wide shell authorization', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'example.com', action: 'allow' }],
      }),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      message: expect.stringContaining('进程级网络访问'),
    });
  });

  it('checks every network target in a compound shell command', async () => {
    const { host } = await createHost({
      policyAmendmentStore: new StaticPolicyAmendmentStore({
        execPolicyAmendments: [],
        networkPolicyAmendments: [{ host: 'blocked.example', action: 'deny' }],
      }),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://allowed.example; curl https://blocked.example',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      data: { network_policy_decision: 'deny' },
      message: expect.stringContaining('blocked.example'),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://allowed.example\nssh blocked.example',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_2',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      failureKind: 'network_denied',
      data: { network_policy_decision: 'deny' },
      message: expect.stringContaining('blocked.example'),
    });
  });

  it('builds a macOS seatbelt profile for workspace-write shell sandboxing', async () => {
    const root = path.join(tmpdir(), 'setsuna seatbelt workspace');
    const writableRoot = path.join(tmpdir(), 'setsuna approved writes');
    const deniedRoot = path.join(root, 'blocked');
    const shellTempRoot = await realpath(tmpdir());
    const capability = { supported: true, provider: 'macos-seatbelt', reason: '' };
    const workspaceFilter = `(require-not (subpath ${JSON.stringify(path.resolve(root))}))`;
    const writableRootFilter = `(require-not (subpath ${JSON.stringify(path.resolve(writableRoot))}))`;
    const shellTempRootFilter = `(require-not (subpath ${JSON.stringify(shellTempRoot)}))`;
    const devNullFilter = `(require-not (literal ${JSON.stringify('/dev/null')}))`;
    const denyOutsideWritableRoots = `(deny file-write* (require-all ${workspaceFilter} ${writableRootFilter} ${shellTempRootFilter} ${devNullFilter}))`;

    const state = {
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        writableRoots: [writableRoot],
        deniedRoots: ['blocked'],
        deniedGlobPatterns: [path.join(root, '**/*.env')],
        networkAccess: false,
      },
    };
    const plan = createShellSandboxExecutionPlan(state, {
      capability,
      environment: { TMPDIR: tmpdir() },
      temporaryRoot: tmpdir(),
    });
    const profile = shellSandboxProfile(plan, capability);

    const lines = profile.split('\n');
    expect(lines.slice(0, 2)).toEqual(['(version 1)', '(allow default)']);
    expect(lines).toContain('(deny network*)');
    expect(lines).toContain(denyOutsideWritableRoots);
    expect(lines.some((line) => line.startsWith('(deny file-read* (require-all ')
      && line.includes(`(require-not (subpath ${JSON.stringify(path.resolve(root))}))`)
      && line.includes('(require-not (literal "/"))'))).toBe(true);
    expect(lines).toEqual(expect.arrayContaining([
      `(deny file-read* (literal ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-read* (subpath ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (literal ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (subpath ${JSON.stringify(path.resolve(deniedRoot))}))`,
      `(deny file-write* (literal ${JSON.stringify(path.join(path.resolve(root), '.git'))}))`,
    ]));
    expect(lines.some((line) => line.startsWith('(deny file-read* (regex ') && line.includes('.env'))).toBe(true);
    expect(lines.some((line) => line.startsWith('(deny file-write* (regex ') && line.includes('.env'))).toBe(true);
    expect(shellSandboxUnavailableReason({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
    }, capability)).toBe('');
  });

  it('builds one explicit sandbox execution plan for the provider', async () => {
    const root = path.join(tmpdir(), 'setsuna-explicit-plan');
    const toolchainRoot = path.join(tmpdir(), 'setsuna-toolchain');
    const canonicalTempRoot = await realpath(tmpdir());
    const environment = {
      PATH: path.join(toolchainRoot, 'bin'),
      COREPACK_HOME: path.join(root, '.cache'),
      TMPDIR: tmpdir(),
    };
    const plan = createShellSandboxExecutionPlan({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        readableRoots: [toolchainRoot],
        writableRoots: [path.join(root, '.cache')],
        networkAccess: false,
      },
    }, {
      cwd: root,
      environment,
      capability: { supported: true, provider: 'macos-seatbelt', reason: '' },
      temporaryRoot: tmpdir(),
    });

    expect(plan).toMatchObject({
      cwd: path.resolve(root),
      environment,
      networkAccess: false,
      permissionProfile: 'workspace-write',
      provider: 'macos-seatbelt',
      workspaceRoot: path.resolve(root),
    });
    expect(plan.readableRoots).toEqual(expect.arrayContaining([
      path.resolve(root),
      path.resolve(toolchainRoot),
      path.resolve(tmpdir()),
      canonicalTempRoot,
    ]));
    expect(plan.writableRoots).toEqual(expect.arrayContaining([
      path.resolve(root),
      path.join(path.resolve(root), '.cache'),
      canonicalTempRoot,
    ]));

    const planWithoutExplicitTempRoot = createShellSandboxExecutionPlan({
      root,
      osSandbox: true,
      permissionProfile: 'workspace-write',
    }, {
      environment,
      capability: { supported: true, provider: 'macos-seatbelt', reason: '' },
    });
    expect(planWithoutExplicitTempRoot.writableRoots).not.toContain(canonicalTempRoot);
  });

  it('keeps macOS seatbelt network open only after sandbox network approval', () => {
    const capability = { supported: true, provider: 'macos-seatbelt', reason: '' };
    const profile = shellSandboxProfile({
      root: path.join(tmpdir(), 'setsuna seatbelt network'),
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { networkAccess: true },
    }, capability);

    expect(profile).not.toContain('(deny network*)');
    expect(profile).toContain('(deny file-write*');
  });

  it('routes restricted Windows shell execution through the sandbox-unavailable approval path', () => {
    const capability = shellSandboxCapability('win32');
    expect(capability).toMatchObject({ supported: false, provider: '' });
    expect(shellSandboxUnavailableReason({
      root: 'C:\\workspace',
      osSandbox: true,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
    }, capability)).toContain('显式批准一次无沙箱重试');
    expect(shellSandboxUnavailableReason({
      root: 'C:\\workspace',
      osSandbox: true,
      permissionProfile: 'danger-full-access',
      sandboxWorkspaceWrite: {},
    }, capability)).toBe('');
  });

  it('allows read-only shell writes only inside approved writable roots', async () => {
    const { host, projectDir } = await createHost();
    const grantedDir = path.join(projectDir, 'granted');
    await mkdir(grantedDir, { recursive: true });

    const execution = host.runTool('run_shell_command', {
      command: 'touch granted/ok.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['granted'] },
    });

    if (restrictedShellExecutionUnavailable) {
      await expectRestrictedShellUnavailable(execution);
      await expect(readFile(path.join(grantedDir, 'ok.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const result = await execution;
      expect(result.content).toContain('Exit Code: 0');
      await expect(readFile(path.join(grantedDir, 'ok.txt'), 'utf8')).resolves.toBe('');
    }
    await expect(host.runTool('run_shell_command', {
      command: 'touch denied.txt',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['granted'] },
    })).rejects.toThrow('未授权路径');
  });

  it('blocks obvious shell network access until network access is approved for the attempt', async () => {
    const { host } = await createHost();

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'example.com',
          protocol: 'https',
          port: 443,
          target: 'https://example.com:443',
        },
      },
      message: expect.stringContaining('network_access'),
    });

    await expect(host.runTool('run_shell_command', {
      command: 'curl https://read-only.example.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'read-only.example.com',
          protocol: 'https',
          port: 443,
          target: 'https://read-only.example.com:443',
        },
      },
    });

    await expect(host.runTool('run_shell_command', {
      command: 'ssh git@github.com',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { networkAccess: false },
    })).rejects.toMatchObject({
      name: ToolExecutionError.name,
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: {
          host: 'github.com',
          protocol: 'tcp',
          port: 22,
          target: 'tcp://github.com:22',
        },
      },
    });
  });

  it('fails closed for opaque scripts under restricted shell profiles', async () => {
    const { host, projectDir, projectId } = await createHost();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-shell-escape-test-'));
    const outsideTarget = path.join(outsideDir, 'escaped.txt');
    await writeFile(path.join(projectDir, 'escape.cjs'), [
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(outsideTarget)}, 'escaped');`,
      '',
    ].join('\n'), 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} escape.cjs`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_restricted',
      turnId: 'turn_restricted',
      projectId,
      permissionProfile: 'workspace-write',
    })).rejects.toThrow();
    await expect(readFile(outsideTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} escape.cjs`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_unrestricted',
      turnId: 'turn_unrestricted',
      projectId,
      permissionProfile: 'danger-full-access',
    })).resolves.toMatchObject({ content: expect.stringContaining('Sandbox: bypass') });
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('escaped');
  });

  it('keeps concurrent tool permissions isolated per invocation', async () => {
    const { host, projectDir, projectId } = await createHost();
    const [readOnlyWrite, workspaceWrite] = await Promise.allSettled([
      host.runTool('write_file', { file_path: 'read-only.txt', content: 'must not exist\n' }, {
        threadId: 'thread_read_only',
        turnId: 'turn_read_only',
        projectId,
        permissionProfile: 'read-only',
      }),
      host.runTool('write_file', { file_path: 'workspace.txt', content: 'allowed\n' }, {
        threadId: 'thread_workspace',
        turnId: 'turn_workspace',
        projectId,
        permissionProfile: 'workspace-write',
      }),
    ]);

    expect(readOnlyWrite.status).toBe('rejected');
    expect(workspaceWrite.status).toBe('fulfilled');
    await expect(readFile(path.join(projectDir, 'read-only.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(projectDir, 'workspace.txt'), 'utf8')).resolves.toBe('allowed\n');
  });

  it('does not execute MCP configuration through the pc tool path', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.previewToolCall('configure_mcp_server', { key: 'remote', url: 'https://example.com/mcp' }, context))
      .resolves.toBeNull();
    await expect(host.runTool('configure_mcp_server', { key: 'remote', url: 'https://example.com/mcp' }, context))
      .rejects.toThrow('Unknown tool');
  });

  it('forwards shell stdout as tool output deltas', async () => {
    const { host } = await createHost();
    const deltas: Array<{ delta: string; stream?: string; processId?: string }> = [];

    const result = await host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "process.stdout.write('pc delta\\n')"`,
        risk_level: 'low',
        yield_time_ms: 0,
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'danger-full-access',
        onToolOutputDelta: (delta) => deltas.push(delta),
      },
    );

    expect(result.content).toContain('pc delta');
    expect(deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ delta: expect.stringContaining('pc delta'), stream: 'stdout', processId: expect.any(String) }),
    ]));
  });

  it('does not retain pending progress output after a shell command yields', async () => {
    const { host } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access' as const,
      onToolOutputDelta: () => undefined,
    };
    const running = await host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "setTimeout(() => process.stdout.write('x'.repeat(500000)), 20); setInterval(() => {}, 1000)"`,
      risk_level: 'low',
      yield_time_ms: 1,
    }, context);
    const processId = String((running.data as Record<string, unknown>).process_id || '');

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const processStore = (host as unknown as {
        shellProcessStore: { sessions: Map<string, { pendingStdout: string; pendingStderr: string; stdout: string }> };
      }).shellProcessStore;
      const session = processStore.sessions.get(processId);
      expect(session?.pendingStdout).toBe('');
      expect(session?.pendingStderr).toBe('');
      expect(session?.stdout.length).toBeLessThanOrEqual(240_000);
    } finally {
      await host.runTool('terminate_shell_process', { process_id: processId }, context).catch(() => undefined);
    }
  });

  it('propagates a pre-aborted shell invocation as cancellation', async () => {
    const { host } = await createHost();
    const controller = new AbortController();
    controller.abort('cancel before spawn');

    await expect(host.runTool('run_shell_command', {
      command: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError', message: 'cancel before spawn' });
  });

  it('propagates a pre-aborted Git invocation as cancellation', async () => {
    const { host } = await createHost();
    const controller = new AbortController();
    controller.abort('cancel git');

    await expect(host.runTool('git_status', {}, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError', message: 'cancel git' });
  });

  it('returns complete shell output when a command fails', async () => {
    const { host } = await createHost();

    await expect(host.runTool(
      'run_shell_command',
      {
        command: `${nodeCommand()} -e "process.stderr.write('precise shell failure\\n'); process.exit(7)"`,
        risk_level: 'low',
        yield_time_ms: 0,
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        sandbox: { mode: 'bypass' },
      },
    )).rejects.toThrow('precise shell failure');
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('preserves the managed PATH inside the macOS shell sandbox', async () => {
    let managedBin = '';
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          python3: { executablePath: path.join(managedBin, 'python3'), installationRoot: managedBin },
        },
        environment: { PATH: [managedBin, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter) },
        readableRoots: [managedBin],
        writableCacheRoots: [],
      }),
    });
    const { host, projectDir } = await createHost({ workspaceDependencies });
    managedBin = path.join(projectDir, '.managed-bin');
    const managedPython = path.join(managedBin, 'python3');
    await mkdir(managedBin, { recursive: true });
    await writeFile(managedPython, '#!/bin/sh\necho "Python 3.12.99 managed"\n', 'utf8');
    await chmod(managedPython, 0o755);

    const result = await host.runTool('run_shell_command', {
      command: 'command -v python3 && python3 --version',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { networkAccess: false },
    });

    expect(result.content).toContain(managedPython);
    expect(result.content).toContain('Python 3.12.99 managed');
    expect(result.content).not.toContain('/usr/bin/python3');
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('follows fnm-style PATH and package symlinks inside the macOS shell sandbox', async () => {
    const dependencyRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-fnm-toolchain-'));
    const installationRoot = path.join(dependencyRoot, 'node-versions', 'v22.23.1', 'installation');
    const installationBin = path.join(installationRoot, 'bin');
    const packageExecutable = path.join(installationRoot, 'lib', 'node_modules', 'setsuna-tool', 'bin', 'setsuna-fnm-tool-test');
    const defaultAlias = path.join(dependencyRoot, 'aliases', 'default');
    const sessionRoot = path.join(dependencyRoot, 'fnm_multishells', 'session');
    await mkdir(path.dirname(packageExecutable), { recursive: true });
    await mkdir(installationBin, { recursive: true });
    await mkdir(path.dirname(defaultAlias), { recursive: true });
    await mkdir(path.dirname(sessionRoot), { recursive: true });
    await writeFile(packageExecutable, '#!/bin/sh\necho "fnm package tool available"\n', 'utf8');
    await chmod(packageExecutable, 0o755);
    await symlink('../lib/node_modules/setsuna-tool/bin/setsuna-fnm-tool-test', path.join(installationBin, 'setsuna-fnm-tool-test'));
    await symlink(installationRoot, defaultAlias);
    await symlink(defaultAlias, sessionRoot);
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          'setsuna-fnm-tool-test': {
            executablePath: path.join(sessionRoot, 'bin', 'setsuna-fnm-tool-test'),
            installationRoot,
          },
        },
        environment: { PATH: [path.join(sessionRoot, 'bin'), '/usr/bin', '/bin'].join(path.delimiter) },
        readableRoots: [path.join(sessionRoot, 'bin'), installationRoot],
        writableCacheRoots: [],
      }),
    });
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: 'setsuna-fnm-tool-test --version',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('fnm package tool available');
    } finally {
      await host.shutdown();
      await rm(dependencyRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('grants managed toolchain read roots to the macOS shell sandbox', async () => {
    const managedRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-managed-toolchain-'));
    const wrapperBin = path.join(managedRoot, 'bin');
    const target = path.join(managedRoot, 'toolchain', 'python', 'bin', 'setsuna-managed-python-test');
    const marker = path.join(managedRoot, 'toolchain', 'python', 'lib', 'marker.txt');
    await mkdir(wrapperBin, { recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, 'managed Python stdlib readable\n', 'utf8');
    await writeFile(target, `#!/bin/sh\n/bin/cat ${JSON.stringify(marker)}\n`, 'utf8');
    await chmod(target, 0o755);
    await writeFile(path.join(wrapperBin, 'setsuna-managed-python-test'), `#!/bin/sh\nexec ${JSON.stringify(target)} "$@"\n`, 'utf8');
    await chmod(path.join(wrapperBin, 'setsuna-managed-python-test'), 0o755);
    const workspaceDependencies = stubWorkspaceDependencyManager({
      prepareShellToolchain: async () => ({
        commands: {
          'setsuna-managed-python-test': {
            executablePath: path.join(wrapperBin, 'setsuna-managed-python-test'),
            installationRoot: managedRoot,
          },
        },
        environment: { PATH: [wrapperBin, '/usr/bin', '/bin'].join(path.delimiter) },
        readableRoots: [managedRoot],
        writableCacheRoots: [],
      }),
    });
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: 'setsuna-managed-python-test',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('managed Python stdlib readable');
    } finally {
      await host.shutdown();
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(
    process.platform !== 'darwin'
      || !existsSync('/usr/bin/sandbox-exec')
      || !['node', 'pnpm', 'corepack', 'python3', 'pip3', 'uv'].every(commandAvailableOnPath),
  )('runs the baseline Node and Python toolchain through the real macOS sandbox', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-real-toolchain-'));
    const previousPath = process.env.PATH;
    const runtimePackageBin = path.resolve('node_modules', '.bin');
    process.env.PATH = String(previousPath ?? '')
      .split(path.delimiter)
      .filter((entry) => entry && path.resolve(entry) !== runtimePackageBin)
      .join(path.delimiter);
    const configStore = new FileConfigStore(dependencyDataDir);
    await configStore.saveConfig({ desktopSettings: { workspaceDependenciesEnabled: false } });
    const workspaceDependencies = new ManagedWorkspaceDependencyManager(dependencyDataDir, configStore);
    const { host } = await createHost({ workspaceDependencies });

    try {
      const result = await host.runTool('run_shell_command', {
        command: [
          'node --version',
          'pnpm --version',
          'corepack --version',
          'python3 --version',
          'pip3 --version',
          'uv --version',
        ].join(' && '),
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      expect(result.content).toMatch(/v\d+\.\d+/u);
      expect(result.content).toContain('Python');
      expect(result.content).toContain('uv');
    } finally {
      process.env.PATH = previousPath;
      await host.shutdown();
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(
    process.platform !== 'darwin'
      || !existsSync('/usr/bin/sandbox-exec')
      || !commandAvailableOnPath('node'),
  )('allows the active macOS temp directory when the workspace is elsewhere', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-temp-sandbox-'));
    const configStore = new FileConfigStore(dependencyDataDir);
    await configStore.saveConfig({ desktopSettings: { workspaceDependenciesEnabled: false } });
    const workspaceDependencies = new ManagedWorkspaceDependencyManager(dependencyDataDir, configStore);
    const { host, projectDir, fixtureRoot } = await createHost({
      fixtureRootParent: homedir(),
      workspaceDependencies,
    });
    const scriptName = 'verify-sandbox-temp.cjs';
    await writeFile(path.join(projectDir, scriptName), [
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      "const path = require('node:path');",
      'const tempRoot = fs.realpathSync(os.tmpdir());',
      "const marker = path.join(tempRoot, `setsuna-temp-${process.pid}-${Date.now()}`);",
      "fs.writeFileSync(marker, 'ok');",
      'fs.unlinkSync(marker);',
      "process.stdout.write(`temp-ok:${tempRoot}\\n`);",
    ].join('\n'), 'utf8');

    try {
      const result = await host.runTool('run_shell_command', {
        command: `node ${scriptName}`,
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      const shellTempRoot = result.content.match(/^temp-ok:(.+)$/mu)?.[1]?.trim();
      expect(shellTempRoot).toBeTruthy();
      expect(path.dirname(String(shellTempRoot))).toBe(await realpath(tmpdir()));
      expect(path.basename(String(shellTempRoot))).toMatch(/^setsuna-shell-/u);
      expect(existsSync(String(shellTempRoot))).toBe(false);
    } finally {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('runs the app-owned Corepack fallback through the real macOS sandbox', async () => {
    const dependencyDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-corepack-sandbox-'));
    const fakeBin = path.join(dependencyDataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    let host: PcLocalToolHost | null = null;
    await mkdir(fakeBin, { recursive: true });
    const fakeNode = path.join(fakeBin, 'node');
    await writeFile(fakeNode, '#!/bin/sh\necho v22.23.1\n', 'utf8');
    await chmod(fakeNode, 0o755);
    process.env.PATH = fakeBin;

    try {
      const configStore = new FileConfigStore(dependencyDataDir);
      const workspaceDependencies = new ManagedWorkspaceDependencyManager(dependencyDataDir, configStore);
      const created = await createHost({ workspaceDependencies });
      host = created.host;
      const result = await host.runTool('run_shell_command', {
        command: 'corepack --version',
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        permissionProfile: 'workspace-write',
        sandboxWorkspaceWrite: { networkAccess: false },
      });

      expect(result.content).toContain('Sandbox: macos-seatbelt');
      expect(result.content).toContain('0.34.7');
    } finally {
      process.env.PATH = previousPath;
      await host?.shutdown();
      await rm(dependencyDataDir, { recursive: true, force: true });
    }
  });

  it('classifies a host-visible command-not-found result as sandbox denial', async () => {
    const dependencyRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-hidden-path-tool-'));
    const binDir = path.join(dependencyRoot, 'bin');
    const executable = path.join(binDir, 'setsuna-hidden-path-tool-test');
    await mkdir(binDir, { recursive: true });
    await writeFile(executable, '#!/bin/sh\necho hidden tool\n', 'utf8');
    await chmod(executable, 0o755);

    try {
      const session = {
        cwd: dependencyRoot,
        environment: { PATH: binDir },
        exitCode: 127,
      };
      expect(shellCommandHiddenBySandbox(
        '/bin/sh: line 1: setsuna-hidden-path-tool-test: command not found',
        session,
      )).toBe(true);
      expect(shellCommandHiddenBySandbox('/bin/sh: missing-tool: command not found', session)).toBe(false);
    } finally {
      await rm(dependencyRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('enforces macOS shell readable roots after variable expansion', async () => {
    const { host, projectDir } = await createHost();
    const secretDir = await mkdtemp(path.join(homedir(), '.setsuna-seatbelt-secret-'));
    const secretPath = path.join(secretDir, 'secret.txt');
    await writeFile(secretPath, 'must stay private\n', 'utf8');
    await writeFile(path.join(projectDir, 'visible.txt'), 'workspace visible\n', 'utf8');
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: { networkAccess: false },
    };

    try {
      const visible = await host.runTool('run_shell_command', {
        command: 'cat visible.txt',
        risk_level: 'low',
        yield_time_ms: 0,
      }, context);
      expect(visible.content).toContain('workspace visible');

      await expect(host.runTool('run_shell_command', {
        command: `cat "$HOME/${path.basename(secretDir)}/secret.txt"`,
        risk_level: 'low',
        yield_time_ms: 0,
      }, context)).rejects.toMatchObject({
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
      await expect(host.runTool('run_shell_command', {
        command: 'cat /etc/passwd',
        risk_level: 'low',
        yield_time_ms: 0,
      }, context)).rejects.toMatchObject({
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('enforces denied globs in the macOS shell sandbox after variable expansion', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, '.env'), 'SECRET=blocked\n', 'utf8');

    await expect(host.runTool('run_shell_command', {
      command: 'suffix=env; cat ".${suffix}"',
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {
        deniedGlobPatterns: [path.join(projectDir, '**/*.env')],
        networkAccess: false,
      },
    })).rejects.toMatchObject({
      failureKind: 'sandbox_denied',
      failureStage: 'execution',
    });
  });

  it('stops bounded range reads without buffering the rest of a large file', async () => {
    const { host, projectDir } = await createHost();
    await writeFile(path.join(projectDir, 'large.txt'), `first line\n${'x'.repeat(1_000_000)}`, 'utf8');

    const result = await host.runTool('read_file', {
      file_path: 'large.txt',
      offset: 1,
      limit: 1,
    }, { threadId: 'thread_1', turnId: 'turn_1' });

    expect(result.content).toContain('lines 1-1; file continues');
    expect(result.content).toContain('1: first line');
    expect(result.content.length).toBeLessThan(1_000);
  });

  it('supports Codex-compatible exec_command and write_stdin tool names', async () => {
    const { host } = await createHost();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      permissionProfile: 'danger-full-access' as const,
    };
    const execResult = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdout.write('exec compat\\n')"`,
        yield_time_ms: 0,
      },
      context,
    );

    expect(execResult.content).toContain('exec compat');
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf risky',
      sandbox_permissions: 'require_escalated',
      justification: 'needs unsandboxed access',
    }, context)).resolves.toMatchObject({
      reason: expect.stringContaining('needs unsandboxed access'),
    });
    await expect(host.approvalForTool('exec_command', {
      cmd: 'printf extra',
      sandbox_permissions: 'with_additional_permissions',
      additional_permissions: { network: { enabled: true } },
    }, context)).resolves.toMatchObject({
      reason: expect.stringContaining('高风险'),
    });

    const interactive = await host.runTool(
      'exec_command',
      {
        cmd: `${nodeCommand()} -e "process.stdin.once('data', d => { process.stdout.write('stdin:' + d.toString()); process.exit(0); }); setInterval(() => {}, 1000)"`,
        yield_time_ms: 1,
      },
      context,
    );
    const processId = String((interactive.data as Record<string, unknown>).process_id || '');
    expect(processId).toBeTruthy();

    await expect(host.runTool('write_stdin', {
      session_id: processId,
      chars: 'hello\n',
    }, context)).resolves.toMatchObject({
      content: expect.stringContaining('Wrote'),
    });
    const polled = await host.runTool('write_stdin', {
      session_id: processId,
      chars: '',
      yield_time_ms: 500,
    }, context);
    expect(polled.content).toContain('stdin:hello');
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
      await expect(host.terminateBackgroundShellProcess('thread_other', processId)).resolves.toEqual({ terminated: false });
      await expect(host.listBackgroundShellProcesses(context.threadId)).resolves.toHaveLength(1);

      await expect(host.terminateBackgroundShellProcess(context.threadId, processId)).resolves.toEqual({ terminated: true });
      await expect(host.listBackgroundShellProcesses(context.threadId)).resolves.toEqual([]);
    } finally {
      await host.terminateBackgroundShellProcess(context.threadId, processId).catch(() => undefined);
    }
  });
});

async function expectRestrictedShellUnavailable(execution: Promise<unknown>): Promise<void> {
  await expect(execution).rejects.toMatchObject({
    failureKind: 'sandbox_denied',
    failureStage: 'preflight',
  });
}

async function createHost(options: {
  fixtureRootParent?: string;
  policyAmendmentStore?: PolicyAmendmentStore;
  projectDirName?: string;
  workspaceDependencies?: WorkspaceDependencyManager;
} = {}): Promise<{ fixtureRoot: string; host: PcLocalToolHost; projectDir: string; projectId: string }> {
  const fixtureRootParent = options.fixtureRootParent ?? tmpdir();
  const root = await mkdtemp(path.join(fixtureRootParent, 'setsuna-pc-toolhost-test-'));
  const temporaryWorkspaceRoot = path.join(root, options.projectDirName ?? 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(temporaryWorkspaceRoot, { recursive: true });
  const store = new FileWorkspaceProjectStore(dataDir, systemClock, {
    temporaryWorkspacePath: temporaryWorkspaceRoot,
  });
  // Most cases intentionally omit projectId, so fixture files must live in the same
  // per-thread workspace that the runtime resolver selects for thread_1.
  const projectDir = (await store.ensureTemporaryWorkspace({ threadId: 'thread_1' })).path;
  const project = await store.addProject({ path: projectDir });
  return {
    fixtureRoot: root,
    host: new PcLocalToolHost(store, options.policyAmendmentStore, options.workspaceDependencies),
    projectDir,
    projectId: project.id,
  };
}

function stubWorkspaceDependencyManager(
  overrides: Partial<WorkspaceDependencyManager> = {},
): WorkspaceDependencyManager {
  const status: RuntimeWorkspaceDependenciesStatus = {
    bundleVersion: 'test',
    checks: [],
    enabled: true,
    installPath: '/managed',
    node: { available: true },
    python: { available: true },
    state: 'ready',
    uv: { available: true },
  };
  return {
    diagnose: async () => status,
    getPromptContext: async () => ({ enabled: true }),
    getStatus: async () => status,
    prepareShellToolchain: async ({ environment }) => ({
      commands: {},
      environment: { PATH: process.env.PATH ?? '' },
      readableRoots: [environment.workspaceRoot],
      writableCacheRoots: [],
    }),
    reinstall: async () => status,
    setEnabled: async () => status,
    ...overrides,
  };
}

function commandAvailableOnPath(command: string): boolean {
  return String(process.env.PATH ?? '').split(path.delimiter)
    .filter(Boolean)
    .some((directory) => existsSync(path.join(directory, command)));
}

class StaticPolicyAmendmentStore implements PolicyAmendmentStore {
  constructor(private readonly amendments: RuntimePolicyAmendments) {}

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return {
      execPolicyAmendments: this.amendments.execPolicyAmendments.map((item) => [...item]),
      networkPolicyAmendments: this.amendments.networkPolicyAmendments.map((item) => ({ ...item })),
    };
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    this.amendments.execPolicyAmendments.push([...amendment]);
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment): Promise<void> {
    this.amendments.networkPolicyAmendments.push({ ...amendment });
  }
}

function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}

function shellApplyPatchCommand(filePath: string): string {
  return [
    "apply_patch <<'PATCH'",
    '*** Begin Patch',
    `*** Add File: ${filePath}`,
    '+generated',
    '*** End Patch',
    'PATCH',
  ].join('\n');
}
