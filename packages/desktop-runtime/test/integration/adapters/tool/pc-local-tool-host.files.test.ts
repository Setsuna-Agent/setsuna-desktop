import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PcLocalToolHost } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { FileWorkspaceProjectStore } from '../../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../../src/ports/clock.js';
import { execFileAsync, createHost } from './pc-local-tool-host.support.js';

describe('pc local file tools and previews', () => {
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

  it('treats precise edit replacement text literally', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'src', 'literal-replacement.ts');
    const replacement = 'return new RegExp(`^${source}$`);';

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'prefix\nTARGET\nsuffix\n', 'utf8');

    const edited = await host.runTool('edit', {
      file_path: 'src/literal-replacement.ts',
      old_string: 'TARGET',
      new_string: replacement,
    }, context);

    expect(JSON.parse(edited.preview ?? '{}')).toMatchObject({
      diff: { additions: 1, deletions: 1 },
    });
    await expect(readFile(filePath, 'utf8'))
      .resolves.toBe(`prefix\n${replacement}\nsuffix\n`);
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

  it('keeps legacy workspace tool names as execution aliases', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await writeFile(path.join(projectDir, 'README.md'), 'legacy workspace needle\n', 'utf8');

    const listed = await host.runTool('workspace_list_directory', {}, context);
    const read = await host.runTool('workspace_read_file', { path: 'README.md' }, context);
    const searched = await host.runTool('workspace_search_text', { query: 'legacy workspace' }, context);
    await host.runTool('workspace_write_file', { path: 'generated.txt', content: 'generated\n' }, context);

    expect(listed.content).toContain('README.md');
    expect(read.content).toContain('legacy workspace needle');
    expect(searched.content).toContain('README.md');
    await expect(readFile(path.join(projectDir, 'generated.txt'), 'utf8')).resolves.toBe('generated\n');
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

  it('waits for a complete streaming apply_patch file header before exposing its path', async () => {
    const { host } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const incompleteHeader = await host.previewPartialToolCall?.(
      'apply_patch',
      '{"patch":"*** Begin Patch\\n*** Update File: src/index',
      context,
    );
    const completeHeader = await host.previewPartialToolCall?.(
      'apply_patch',
      '{"patch":"*** Begin Patch\\n*** Update File: src/index.css\\n',
      context,
    );
    const extensionlessHeader = await host.previewPartialToolCall?.(
      'apply_patch',
      '{"patch":"*** Begin Patch\\n*** Update File: Dockerfile\\n',
      context,
    );

    expect(incompleteHeader).toBeNull();
    expect(JSON.parse(completeHeader?.resultPreview ?? '{}')).toMatchObject({
      diff: {
        path: 'src/index.css',
        additions: 0,
        deletions: 0,
        partial: true,
      },
    });
    expect(JSON.parse(extensionlessHeader?.resultPreview ?? '{}')).toMatchObject({
      diff: { path: 'Dockerfile' },
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

  it('allows Add File patches to create empty files', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'empty.txt');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: empty.txt',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(filePath, 'utf8')).resolves.toBe('');
  });

  it('preserves file bytes in move-only patches', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const sourcePath = path.join(projectDir, 'source.txt');
    const destinationPath = path.join(projectDir, 'destination.txt');

    await writeFile(sourcePath, 'alpha', 'utf8');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: source.txt',
        '*** Move to: destination.txt',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('alpha');
    await expect(readFile(sourcePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses Codex @@ context to target repeated patch content', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'src', 'repeated.ts');

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, [
      'function first() {',
      "  return 'same';",
      '}',
      '',
      'function second() {',
      "  return 'same';",
      '}',
      '',
    ].join('\n'), 'utf8');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/repeated.ts',
        '@@ function second() {',
        "-  return 'same';",
        "+  return 'second';",
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(filePath, 'utf8')).resolves.toBe([
      'function first() {',
      "  return 'same';",
      '}',
      '',
      'function second() {',
      "  return 'second';",
      '}',
      '',
    ].join('\n'));
  });

  it('preserves append-only patch order and terminates a non-empty result', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'ordered-appends.txt');

    await writeFile(filePath, 'existing', 'utf8');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: ordered-appends.txt',
        '@@',
        '+first',
        '@@',
        '+second',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(filePath, 'utf8')).resolves.toBe('existing\nfirst\nsecond\n');
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
});
