import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PcLocalToolHost } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { FileWorkspaceProjectStore } from '../../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../../src/ports/clock.js';
import { execFileAsync, createHost } from './pc-local-tool-host.support.js';

describe('pc local file tools and previews', () => {
  it('keeps overwrite observations scoped to actual reads in the current turn', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const input = { file_path: 'observed.txt', content: 'new\n' };
    await writeFile(path.join(projectDir, input.file_path), 'old\n');
    expect(await host.previewToolCall('write_file', input, context)).toHaveProperty('integrityToken');
    await expect(host.runTool('write_file', input, context)).rejects.toThrow('完整读取');
    await host.runTool('read_file', { file_path: input.file_path }, context);
    await expect(host.runTool('write_file', input, { ...context, turnId: 'turn_2' })).rejects.toThrow('完整读取');
    const written = await host.runTool('write_file', input, context);
    expect(written.content).toContain('Edited "observed.txt" (+1/-1)');
    expect(await readFile(path.join(projectDir, input.file_path), 'utf8')).toBe(input.content);
  });

  it('diagnoses reversed hunks before committing any file, then accepts the ordered patch', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const original = 'function first() {\n  return 1;\n}\n\nfunction second() {\n  return 2;\n}\n';
    await writeFile(path.join(projectDir, 'functions.ts'), original);
    const first = '@@\n function first() {\n-  return 1;\n+  return 10;\n }';
    const second = '@@\n function second() {\n-  return 2;\n+  return 20;\n }';
    const patch = (hunks: string[]) => ['*** Begin Patch', '*** Add File: new.txt', '+new', '*** Update File: functions.ts', ...hunks, '*** End Patch'].join('\n');
    await expect(host.runTool('apply_patch', { patch: patch([second, first]) }, context))
      .rejects.toThrow(/第 2 个区块.*原文件第 1 行.*顺序颠倒/u);
    expect(await readFile(path.join(projectDir, 'functions.ts'), 'utf8')).toBe(original);
    await expect(readFile(path.join(projectDir, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = await host.runTool('apply_patch', { patch: patch([first, second]) }, context);
    expect(await readFile(path.join(projectDir, 'functions.ts'), 'utf8')).toBe(original.replace('return 1', 'return 10').replace('return 2', 'return 20'));
    expect(applied.content).toContain('Edited "functions.ts" (+2/-2); new lines 2-6; old lines 2-6');
    expect(applied.content).toContain('+ new 6:   return 20;');
  });

  it('reports actual insertion context and current line numbers to the model independently of the preview', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await writeFile(path.join(projectDir, 'backend.md'), '## 8. Sync\n\n### 8.1 Covers\nExisting paragraph.\n\n### 8.2 Queue\n');
    const result = await host.runTool('apply_patch', { patch: [
      '*** Begin Patch', '*** Update File: backend.md', '@@',
      ' Existing paragraph.', '+', '+## 8.9 Profile', '+New section.',
      '*** End Patch',
    ].join('\n') }, context);
    expect(result.content).toContain('new lines 6-8');
    expect(result.content).toContain('new 4: Existing paragraph.');
    expect(result.content).toContain('+ new 6: ## 8.9 Profile');
    expect(result.content).toContain('new 9: ### 8.2 Queue');
    expect(await readFile(path.join(projectDir, 'backend.md'), 'utf8')).toContain('## 8.9 Profile\nNew section.\n\n### 8.2 Queue');
  });

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
      'run_shell_command',
      'request_permissions',
      'exec_command',
      'write_stdin',
    ]));
    expect(tools.map((tool) => tool.name)).not.toContain('workspace_write_file');
    expect(tools.map((tool) => tool.name)).not.toContain('remember_memory');
    expect(tools.map((tool) => tool.name)).not.toContain('configure_mcp_server');
    expect(tools.some((tool) => ['git_status', 'git_log', 'git_show', 'read_diff'].includes(tool.name))).toBe(false);
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

  it('inspects workspace-scoped Git state and history through shell commands', async () => {
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
    const context = { environment, threadId: 'thread_1', turnId: 'turn_1', projectId: project.id, permissionProfile: 'danger-full-access' as const };

    const git = (cmd: string) => host.runTool('exec_command', { cmd, yield_time_ms: 0 }, context);
    const status = await git('git -c status.relativePaths=true status --short --branch -- .');
    const diff = await git('git --no-pager diff --no-ext-diff --no-textconv --relative -- .');
    const log = await git('git --no-pager log --max-count=5 --oneline -- .');
    const show = await git(`git --no-pager show --no-ext-diff --no-textconv --relative ${initialRevision} -- .`);
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
        '@@   ',
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

  it('ignores bare separator blanks while preserving blank hunk context', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const firstPath = path.join(projectDir, 'first.txt');
    const secondPath = path.join(projectDir, 'second.txt');

    await writeFile(firstPath, 'one\ntwo\n', 'utf8');
    await writeFile(secondPath, 'alpha\n\nomega\n', 'utf8');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: first.txt',
        '@@',
        '-one',
        '+ONE',
        '',
        '@@',
        '-two',
        '+TWO',
        '',
        '*** Update File: second.txt',
        '@@',
        '-alpha',
        '+ALPHA',
        '',
        '-omega',
        '+OMEGA',
        '',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(firstPath, 'utf8')).resolves.toBe('ONE\nTWO\n');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('ALPHA\n\nOMEGA\n');
  });

  it('preserves bare blank context before trailing context lines', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const matchingPath = path.join(projectDir, 'matching.txt');
    const missingBlankPath = path.join(projectDir, 'missing-blank.txt');
    await Promise.all([
      writeFile(matchingPath, 'old\n\ntail\n', 'utf8'),
      writeFile(missingBlankPath, 'old\ntail\n', 'utf8'),
    ]);
    const updatePatch = (fileName: string) => [
      '*** Begin Patch',
      `*** Update File: ${fileName}`,
      '@@',
      '-old',
      '+new',
      '',
      ' tail',
      '*** End Patch',
    ].join('\n');

    await host.runTool('apply_patch', { patch: updatePatch('matching.txt') }, context);
    await expect(host.runTool('apply_patch', {
      patch: updatePatch('missing-blank.txt'),
    }, context)).rejects.toThrow('未找到匹配的旧内容');

    await expect(readFile(matchingPath, 'utf8')).resolves.toBe('new\n\ntail\n');
    await expect(readFile(missingBlankPath, 'utf8')).resolves.toBe('old\ntail\n');
  });

  it('uses context-only hunks to locate later edits and validate the file ending', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'repeated.txt');
    await writeFile(filePath, 'same\nsection\nsame\ntail\n', 'utf8');

    await host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: repeated.txt',
        '@@',
        ' section',
        '@@',
        '-same',
        '+changed',
        '@@',
        ' tail',
        '*** End of File',
        '*** Add File: added.txt',
        '+created',
        '*** End Patch',
      ].join('\n'),
    }, context);

    await expect(readFile(filePath, 'utf8')).resolves.toBe('same\nsection\nchanged\ntail\n');
    await expect(readFile(path.join(projectDir, 'added.txt'), 'utf8')).resolves.toBe('created\n');
  });

  it.each([
    { name: 'missing leading context', hunks: ['@@', ' missing', '@@', '-same', '+changed'], error: '未找到匹配的旧内容' },
    { name: 'context-only EOF mismatch', hunks: ['@@', '-same', '+changed', '@@', ' middle', '*** End of File'], error: '不在文件末尾' },
  ])('rejects $name before writing any files', async ({ hunks, error }) => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.txt');
    const original = 'same\nmiddle\ntail\n';
    await writeFile(filePath, original, 'utf8');

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: added.txt',
        '+must not exist',
        '*** Update File: source.txt',
        ...hunks,
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow(error);

    await expect(readFile(filePath, 'utf8')).resolves.toBe(original);
    await expect(readFile(path.join(projectDir, 'added.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { name: 'empty update', body: [], line: 4, reason: 'hunk 不能为空' },
    { name: 'empty final chunk', body: ['@@'], line: 5, reason: 'hunk 不能为空' },
    { name: 'empty chunk before another chunk', body: ['@@', '@@', '-same', '+changed'], line: 5, reason: 'hunk 不能为空' },
    { name: 'empty chunk before another file', body: ['@@', '*** Delete File: other.txt'], line: 5, reason: 'hunk 不能为空' },
    { name: 'empty chunk before EOF', body: ['@@', '*** End of File'], line: 6, reason: 'End of File 前缺少正文行' },
    { name: 'unprefixed update line', body: ['@@', 'same'], line: 6, reason: '必须以空格、+ 或 - 开头' },
    { name: 'malformed file header in added file', body: ['@@', '-same', '+changed', '*** Add File: other.txt', '*** Update File source.txt'], line: 9, reason: '未识别的补丁标记' },
    { name: 'update hunk in added file', body: ['@@', '-same', '+changed', '*** Add File: other.txt', '@@'], line: 9, reason: '未识别的补丁标记' },
  ])('reports the patch line for $name without applying earlier operations', async ({ body, line, reason }) => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.txt');
    await writeFile(filePath, 'same\n', 'utf8');

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: added.txt',
        '+must not exist',
        '*** Update File: source.txt',
        ...body,
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow(new RegExp(`补丁第 ${line} 行：.*${reason.replaceAll('+', '\\+')}`));

    await expect(readFile(filePath, 'utf8')).resolves.toBe('same\n');
    await expect(readFile(path.join(projectDir, 'added.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('recovers missing Add File prefixes with the same content in previews and committed files', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const sourcePath = path.join(projectDir, 'schema.ts');
    const sqlPath = path.join(projectDir, 'migration.sql');
    await writeFile(sourcePath, 'export const version = 1;\n', 'utf8');
    const args = {
      patch: [
        '*** Begin Patch',
        '*** Update File: schema.ts',
        '@@',
        '-export const version = 1;',
        '+export const version = 2;',
        '*** Add File: migration.sql',
        '+-- 同步任务日志表',
        '',
        'CREATE TABLE sync_job_logs (',
        '  id bigint NOT NULL',
        ');',
        '-- SQL comment without a patch prefix',
        '*** Add File: notes.txt',
        'plain content',
        '++literal plus',
        '+*** End Patch',
        '*** End Patch',
      ].join('\n'),
    };
    const sqlContent = '-- 同步任务日志表\n\nCREATE TABLE sync_job_logs (\n  id bigint NOT NULL\n);\n-- SQL comment without a patch prefix\n';
    const partial = await host.previewPartialToolCall('apply_patch', JSON.stringify(args), context);
    expect(JSON.parse(partial?.resultPreview ?? '{}')).toMatchObject({
      diff: { diffs: [
        { path: 'schema.ts', additions: 1, deletions: 1 },
        { path: 'migration.sql', additions: 6, deletions: 0 },
        { path: 'notes.txt', additions: 3, deletions: 0 },
      ] },
    });
    const preview = await host.previewToolCall('apply_patch', args, context);
    expect(preview?.integrityToken).toBeTruthy();
    const previewDiff = JSON.parse(preview?.resultPreview ?? '{}').diff;
    expect(previewDiff.diffs[1].lines.map((line: { content: string }) => line.content).join('\n') + '\n')
      .toBe(sqlContent);
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe('export const version = 1;\n');
    await expect(readFile(sqlPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const result = await host.runTool('apply_patch', args, {
      ...context,
      expectedPreviewIntegrityToken: preview?.integrityToken,
    });
    expect(JSON.parse(result.preview ?? '{}').diff).toEqual(previewDiff);
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe('export const version = 2;\n');
    await expect(readFile(sqlPath, 'utf8')).resolves.toBe(sqlContent);
    await expect(readFile(path.join(projectDir, 'notes.txt'), 'utf8'))
      .resolves.toBe('plain content\n+literal plus\n*** End Patch\n');
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

  it('requires End of File hunks to match the file ending', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'strict-eof.txt');
    const original = 'target\nmiddle\nending\n';

    await writeFile(filePath, original, 'utf8');

    await expect(host.runTool('apply_patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: strict-eof.txt',
        '@@',
        '-target',
        '+changed',
        '*** End of File',
        '*** End Patch',
      ].join('\n'),
    }, context)).rejects.toThrow('不在文件末尾');

    await expect(readFile(filePath, 'utf8')).resolves.toBe(original);
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
