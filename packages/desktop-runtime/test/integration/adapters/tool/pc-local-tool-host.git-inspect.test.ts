import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellSandboxCapability } from '../../../../src/adapters/tool/pc-local/pc-local-tools.js';
import type { ToolExecutionContext } from '../../../../src/ports/tool-host.js';
import { createHost, execFileAsync } from './pc-local-tool-host.support.js';

describe('Git inspection without an OS sandbox', () => {
  it('reads status, patches, and history in scope without running Git helpers or writing the index', async () => {
    const { host, fixtureRoot, projectDir, projectId } = await createHost({
      shellSandboxCapability: () => shellSandboxCapability('linux'),
    });
    const root = path.join(projectDir, 'scope');
    const marker = path.join(projectDir, 'helper-ran');
    const git = (...args: string[]) => execFileAsync('git', args, { cwd: projectDir });
    const context: ToolExecutionContext = {
      threadId: 'thread_1', turnId: 'review', projectId, readOnly: true,
      permissionProfile: 'danger-full-access',
      sandbox: { mode: 'bypass' },
      environment: { id: 'scope', cwd: root, workspaceRoot: root, workspaceRoots: [root], shell: '/bin/sh' },
    };
    try {
      await mkdir(root);
      await git('init');
      await writeFile(path.join(root, 'tracked.txt'), 'before\n');
      await writeFile(path.join(projectDir, 'outside.txt'), 'outside before\n');
      await git('add', '.');
      await git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial');
      await writeFile(path.join(root, 'tracked.txt'), 'after\n');
      await writeFile(path.join(projectDir, 'outside.txt'), 'outside after\n');
      const index = await readFile(path.join(projectDir, '.git', 'index'));
      const helper = `echo forbidden > "${marker.replace(/\\/g, '/')}"`;
      await git('config', 'core.fsmonitor', helper);
      await git('config', 'filter.review.clean', helper);
      await git('config', 'filter.review.process', helper);
      await git('config', 'filter.review.required', 'true');
      await git('config', 'diff.review.command', helper);
      await git('config', 'diff.review.textconv', helper);
      await git('config', 'log.showSignature', 'true');
      await git('config', 'gpg.program', helper);
      await writeFile(path.join(root, '.gitattributes'), '*.txt filter=review diff=review\n');
      const inspect = (input: Record<string, unknown>) => host.runTool('git_inspect', input, context);

      const status = await inspect({ operation: 'status' });
      expect(status.content).toContain('tracked.txt');
      expect(status.content).not.toContain('outside.txt');
      const diff = await inspect({ operation: 'diff' });
      expect(diff.content).toContain('+after');
      expect(diff.content).not.toContain('outside after');
      expect((await inspect({ operation: 'diff', format: 'name-only' })).content).toContain('tracked.txt');
      expect((await inspect({ operation: 'diff', staged: true })).content).not.toContain('+after');
      expect((await inspect({ operation: 'log' })).content).toContain('initial');
      const show = await inspect({ operation: 'show', revision: 'HEAD' });
      expect(show.content).toContain('+before');
      expect(show.content).not.toContain('outside before');
      expect(await readFile(path.join(projectDir, '.git', 'index'))).toEqual(index);
      await expect(access(marker)).rejects.toThrow();

      for (const input of [
        { operation: 'reset' }, { operation: 'show', revision: '--output=helper-ran' },
        { operation: 'show', revision: 'HEAD:outside.txt' }, { operation: 'diff', path: '../outside.txt' },
        { operation: 'diff', command: 'touch helper-ran' },
      ]) await expect(inspect(input)).rejects.toThrow();
      await expect(inspect({ operation: 'show', revision: 'missing-ref' })).rejects.toMatchObject({
        failureKind: 'process_exit', data: { exit_code: 128 },
      });
      await expect(host.runTool('git_inspect', { operation: 'status' }, { ...context, readOnly: false })).rejects.toThrow('Unknown tool');
      const normalTools = await host.listTools({ ...context, readOnly: false });
      expect(normalTools.map((tool) => tool.name)).not.toContain('git_inspect');
    } finally {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
