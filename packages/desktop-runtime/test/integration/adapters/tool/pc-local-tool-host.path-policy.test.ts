import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { restrictedShellExecutionUnavailable, expectRestrictedShellUnavailable, createHost, nodeCommand, shellApplyPatchCommand } from './pc-local-tool-host.support.js';

describe('pc local path and mutation policy', () => {
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
    await symlink(
      process.platform === 'win32' ? path.join(projectDir, '.git') : '.git',
      path.join(projectDir, 'metadata-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

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
    const targetPath = path.join(projectDir, process.platform === 'win32' ? 'important' : 'important.txt');
    const targetFilePath = process.platform === 'win32' ? path.join(targetPath, 'value.txt') : targetPath;
    const linkPath = path.join(projectDir, process.platform === 'win32' ? 'link' : 'link.txt');
    if (process.platform === 'win32') await mkdir(targetPath);
    await writeFile(targetFilePath, 'keep\n', 'utf8');
    await symlink(
      targetPath,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'file',
    );

    await host.runTool('delete_file', { file_path: path.basename(linkPath) }, context);

    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(targetFilePath, 'utf8')).resolves.toBe('keep\n');
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

  it('allows attachment reads through direct tools without a sandbox readable root', async () => {
    const { host } = await createHost();
    const attachmentRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-direct-tool-attachment-'));
    const target = path.join(attachmentRoot, 'notes.txt');
    await writeFile(target, 'linked attachment\n', 'utf8');

    const result = await host.runTool('read_file', { file_path: target }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      directToolReadableRoots: [target],
      sandboxWorkspaceWrite: {},
    });

    expect(result.content).toContain('linked attachment');
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
});
