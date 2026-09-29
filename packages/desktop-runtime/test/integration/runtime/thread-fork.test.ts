import { applyRuntimeEventToThread, type RuntimeMessage, type RuntimeThread } from '@setsuna-desktop/contracts';
import { createRuntimeSideConversation } from '@setsuna-desktop/feature-side-conversation/runtime';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFactory } from '../../../src/runtime/runtime-factory.js';
import { createSideConversationRuntimeHost } from '../../../src/composition/side-conversation-runtime-host.js';
import { forkRuntimeThread } from '../../../src/runtime/use-cases/thread-fork.js';
import { createRuntimeThread } from '../../../src/runtime/use-cases/thread-create.js';
import { deleteRuntimeThread } from '../../../src/runtime/use-cases/thread-operations.js';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';
import { createTestTempDirectory, removeTestTempDirectory } from '../../support/test-temp-directory.js';

const execFileAsync = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1X8AAAAASUVORK5CYII=', 'base64');

describe('conversation forks', () => {
  let root: string;
  let runtime: ReturnType<typeof createRuntimeFactory>;

  beforeEach(async () => {
    root = await createTestTempDirectory('setsuna-fork-');
    runtime = createRuntimeFactory({ dataDir: path.join(root, 'data'), nativeBridge: new InMemoryDesktopNativeBridge() });
    await runtime.threadStore.recover();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRuntime();
    await removeTestTempDirectory(root);
  });

  async function closeRuntime() {
    await runtime.agentLoop.shutdown();
    await runtime.extensionManager.shutdown();
    await runtime.networkProxyFetch.close();
    await runtime.nativeBridge.close();
    await runtime.threadStore.close();
    await runtime.modelLatencyLog.flush();
  }

  async function append(thread: RuntimeThread, id: string, role: RuntimeMessage['role'], extra: Partial<RuntimeMessage> = {}) {
    const message: RuntimeMessage = { id, role, content: id, status: 'complete', createdAt: thread.createdAt, ...extra };
    await runtime.threadStore.appendEvent(thread.id, {
      id: runtime.ids.id('event'), type: 'message.created', threadId: thread.id,
      turnId: message.turnId, createdAt: thread.createdAt, payload: { message },
    });
    return message;
  }

  it('rejects unavailable worktree targets and cleans up a new worktree if the chat cannot be saved', async () => {
    await expect(createRuntimeThread(runtime, { workspaceMode: 'worktree' })).rejects.toMatchObject({ code: 'invalid_request' });
    const plainDirectory = path.join(root, 'plain');
    await mkdir(plainDirectory);
    const plain = await runtime.workspaceProjects.addProject({ path: plainDirectory });
    await expect(createRuntimeThread(runtime, { projectId: plain.id, workspaceMode: 'worktree' })).rejects.toMatchObject({ code: 'invalid_request' });
    const repository = await createRepository(root);
    const project = await runtime.workspaceProjects.addProject({ path: repository });
    const worktreesBefore = await git(repository, ['worktree', 'list', '--porcelain']);
    vi.spyOn(runtime.threadStore, 'createThread').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(createRuntimeThread(runtime, { projectId: project.id, workspaceMode: 'worktree' })).rejects.toThrow('storage unavailable');
    expect(await git(repository, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);
    expect(await readdir(path.join(runtime.dataDir, 'worktrees'))).toEqual([]);
    expect(await runtime.threadStore.listThreads()).toEqual([]);
    expect((await runtime.workspaceProjects.listProjects()).projects).toHaveLength(2);
  });

  it('forks an inclusive historical boundary repeatedly, with independent assets and no source mutation', async () => {
    const source = await runtime.threadStore.createThread({ title: 'Original', projectId: 'project_1', memoryMode: 'disabled',
      modelBinding: { providerId: 'provider', modelId: 'model', modelCode: 'code' } });
    const attachment = await runtime.attachmentStore.create({ name: 'reference.txt', type: 'text/plain', data: Buffer.from('reference') });
    await runtime.attachmentStore.claimForThread(source.id, [attachment]);
    const generated = await runtime.generatedImageStore.create({ name: 'result.png', type: 'image/png', data: png });
    await append(source, 'question', 'user', { attachments: [attachment], turnId: 'first' });
    await append(source, 'answer', 'assistant', { turnId: 'first', attachments: [{
      source: 'generated', id: 'image', name: 'result.png', type: 'image/png', size: png.length, assetId: generated.assetId,
    }] });
    await append(source, 'later', 'user', { turnId: 'later' });
    const before = await runtime.threadStore.getThread(source.id);
    const fork = await forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'workspace' });
    const second = await forkRuntimeThread(runtime, source.id, { messageId: 'question', target: 'workspace' });
    expect(fork).toMatchObject({ forkedFromId: source.id, projectId: 'project_1', memoryMode: 'disabled', modelBinding: source.modelBinding });
    expect(fork.messages.map((message) => message.id)).toEqual(['question', 'answer']);
    expect(second.messages.map((message) => message.id)).toEqual(['question']);
    expect(await runtime.threadStore.getThread(source.id)).toEqual(before);
    const clonedImage = fork.messages[1]!.attachments![0]!;
    expect(clonedImage.assetId).not.toBe(generated.assetId);
    await deleteRuntimeThread(runtime, source.id);
    expect(await runtime.threadStore.getThread(fork.id)).not.toBeNull();
    expect(await runtime.attachmentStore.resolveForThread(fork.id, [attachment])).toHaveLength(1);
    expect((await runtime.generatedImageStore.read(clonedImage.assetId!)).data).toEqual(png);
    expect(fork.activeTurnId).toBeFalsy();
    expect(fork.queuedTurnInputs ?? []).toEqual([]);
  });

  it('restores the model window before later compaction without resurrecting deleted messages', async () => {
    const source = await runtime.threadStore.createThread();
    await append(source, 'deleted', 'user');
    await append(source, 'question', 'user');
    const answer = await append(source, 'answer', 'assistant');
    await append(source, 'future', 'user');
    const notice = { compactedMessageCount: 4, compactedTokens: 10, originalMessageCount: 4,
      originalTokens: 100, keptRecentMessageCount: 0, maxContextTokensK: 16, transcriptAfterMessageId: 'future' };
    await runtime.threadStore.appendEvent(source.id, {
      id: 'compacted', threadId: source.id, type: 'thread.context_compacted', createdAt: source.createdAt,
      payload: { notice, messages: [{ ...answer, id: 'summary', role: 'system', content: 'Includes future information', contextCompaction: notice }] },
    });
    await runtime.threadStore.deleteMessages(source.id, { messageIds: ['deleted'] });
    const postCompaction = await append(source, 'after_compaction', 'assistant');
    const oldFork = await forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'workspace' });
    expect(oldFork.messages.map((message) => message.id)).toEqual(['question', 'answer']);
    expect(oldFork.messages.every((message) => message.visibility !== 'transcript')).toBe(true);
    const newFork = await forkRuntimeThread(runtime, source.id, { messageId: postCompaction.id, target: 'workspace' });
    expect(newFork.messages.find((message) => message.id === 'summary')?.content).toBe('Includes future information');
    expect(newFork.messages.find((message) => message.id === 'question')?.visibility).toBe('transcript');
    await deleteRuntimeThread(runtime, source.id);
    const nested = await forkRuntimeThread(runtime, newFork.id, { messageId: 'answer', target: 'workspace' });
    expect(nested.messages.map((message) => message.id)).toEqual(['question', 'answer']);
    expect(nested.messages.every((message) => message.visibility !== 'transcript')).toBe(true);
    const fullCopy = await forkRuntimeThread(runtime, newFork.id, { messageId: postCompaction.id, target: 'workspace' });
    expect(fullCopy.messages).toEqual(newFork.messages);
  });

  it('preserves intermediate model windows across repeated forks and runtime recovery', async () => {
    const source = await runtime.threadStore.createThread();
    await append(source, 'question', 'user');
    const answer = await append(source, 'answer', 'assistant');
    const notice = { compactedMessageCount: 2, compactedTokens: 10, originalMessageCount: 2,
      originalTokens: 100, keptRecentMessageCount: 0, maxContextTokensK: 16, transcriptAfterMessageId: 'answer' };
    for (const index of [1, 2]) {
      await runtime.threadStore.appendEvent(source.id, {
        id: `compaction_${index}`, threadId: source.id, type: 'thread.context_compacted', createdAt: source.createdAt,
        payload: { notice, messages: [{ ...answer, id: `summary_${index}`, visibility: 'model', contextCompaction: notice }] },
      });
      await append(source, `after_${index}`, 'assistant');
    }
    const fork = await forkRuntimeThread(runtime, source.id, { messageId: 'after_2', target: 'workspace' });
    await deleteRuntimeThread(runtime, source.id);
    await closeRuntime();
    runtime = createRuntimeFactory({ dataDir: path.join(root, 'data'), nativeBridge: new InMemoryDesktopNativeBridge() });
    await runtime.threadStore.recover();
    const nested = await forkRuntimeThread(runtime, fork.id, { messageId: 'after_1', target: 'workspace' });
    expect(nested.messages.filter((message) => message.visibility !== 'transcript').map((message) => message.id))
      .toEqual(['summary_1', 'after_1']);
    expect(nested.messages.some((message) => message.id === 'summary_2')).toBe(false);
    const earliest = await forkRuntimeThread(runtime, nested.id, { messageId: 'answer', target: 'workspace' });
    expect(earliest.messages.map((message) => message.id)).toEqual(['question', 'answer']);
    expect(earliest.messages.every((message) => message.visibility !== 'transcript')).toBe(true);
  });

  it('copies a compacted side-conversation snapshot with hidden messages and intact boundaries', async () => {
    const source = await runtime.threadStore.createThread();
    await append(source, 'question', 'user');
    const answer = await append(source, 'answer', 'assistant');
    const notice = { compactedMessageCount: 2, compactedTokens: 10, originalMessageCount: 2,
      originalTokens: 100, keptRecentMessageCount: 0, maxContextTokensK: 16, transcriptAfterMessageId: 'answer' };
    await runtime.threadStore.appendEvent(source.id, {
      id: 'compacted', threadId: source.id, type: 'thread.context_compacted', createdAt: source.createdAt,
      payload: { notice, messages: [{ ...answer, id: 'summary', role: 'user', contextCompaction: notice }] },
    });
    await append(source, 'after_compaction', 'assistant');
    const before = await runtime.threadStore.getThread(source.id);

    const side = await createRuntimeSideConversation(createSideConversationRuntimeHost(runtime), source.id);
    const start = side.messages.findIndex((message) => message.content === '<primary_conversation_snapshot>');
    const end = side.messages.findIndex((message) => message.content.startsWith('</primary_conversation_snapshot>'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(side.messages.slice(start + 1, end).map((message) => message.id)).toEqual(['summary', 'after_compaction']);
    expect(side.messages.every((message) => message.visibility === 'model')).toBe(true);
    expect(side.messageCount).toBe(0);
    expect(await runtime.threadStore.getThread(source.id)).toEqual(before);
  });

  it('does not resurrect cleared summaries when forking a fork before its latest compaction', async () => {
    const source = await runtime.threadStore.createThread();
    for (const phase of ['old', 'new']) {
      await append(source, `${phase}_question`, 'user');
      const answer = await append(source, `${phase}_answer`, 'assistant');
      const notice = { compactedMessageCount: 2, compactedTokens: 10, originalMessageCount: 2,
        originalTokens: 100, keptRecentMessageCount: 0, maxContextTokensK: 16, transcriptAfterMessageId: answer.id };
      await runtime.threadStore.appendEvent(source.id, {
        id: `${phase}_compaction`, threadId: source.id, type: 'thread.context_compacted', createdAt: source.createdAt,
        payload: { notice, messages: [{ ...answer, id: `${phase}_summary`, visibility: 'model', contextCompaction: notice }] },
      });
      if (phase === 'old') await runtime.threadStore.clearThreadMessages(source.id);
    }
    await append(source, 'after_compaction', 'assistant');
    const direct = await forkRuntimeThread(runtime, source.id, { messageId: 'new_answer', target: 'workspace' });
    expect(direct.messages.map((message) => message.id)).toEqual(['new_question', 'new_answer']);
    expect(direct.messages.every((message) => message.visibility !== 'transcript')).toBe(true);

    const fork = await forkRuntimeThread(runtime, source.id, { messageId: 'after_compaction', target: 'workspace' });
    await deleteRuntimeThread(runtime, source.id);
    const nested = await forkRuntimeThread(runtime, fork.id, { messageId: 'new_answer', target: 'workspace' });
    expect(nested.messages).toEqual(direct.messages);
  });

  it.each(['fork', 'new'] as const)('preserves non-UTF-8 file bytes when creating a %s worktree, including forced Git colors', async (kind) => {
    const repository = await createRepository(root);
    // GBK text has no NUL byte, so Git emits raw text hunks even with --binary.
    await writeFile(path.join(repository, 'tracked.txt'), Buffer.from('d6d0cec40a', 'hex'));
    await git(repository, ['commit', '-am', 'GBK base']);
    const edited = Buffer.from('b2e2cad40a', 'hex');
    await writeFile(path.join(repository, 'tracked.txt'), edited);
    if (kind === 'new') await git(repository, ['config', 'color.ui', 'always']);
    const project = await runtime.workspaceProjects.addProject({ path: repository });
    const source = await runtime.threadStore.createThread({ projectId: project.id });
    await append(source, 'answer', 'assistant');
    const created = kind === 'fork'
      ? await forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'worktree' })
      : await createRuntimeThread(runtime, { projectId: project.id, workspaceMode: 'worktree' });
    const workspace = (await runtime.workspaceProjects.getStatus(created.workspaceId)).project!;
    expect(await readFile(path.join(workspace.path!, 'tracked.txt'))).toEqual(edited);
    expect(await readFile(path.join(repository, 'tracked.txt'))).toEqual(edited);
  });

  it('copies staged, unstaged, binary, deleted and untracked files into a conversation worktree under the original project without changing the source', async () => {
    const repository = await createRepository(root);
    await writeFile(path.join(repository, 'tracked.txt'), 'staged\n');
    await git(repository, ['add', 'tracked.txt']);
    await writeFile(path.join(repository, 'tracked.txt'), 'unstaged\n');
    const binary = Buffer.from([0, 1, 255, 254, 0, 42]);
    await writeFile(path.join(repository, 'binary.dat'), binary);
    await rm(path.join(repository, 'deleted.txt'));
    await mkdir(path.join(repository, 'new dir'));
    await writeFile(path.join(repository, 'new dir', '你好.txt'), 'untracked');
    await writeFile(path.join(repository, 'ignored.txt'), 'ignored');
    const project = await runtime.workspaceProjects.addProject({ path: repository });
    const source = await runtime.threadStore.createThread({ title: 'Fork test', projectId: project.id });
    await append(source, 'answer', 'assistant');
    const statusBefore = await git(repository, ['status', '--porcelain=v1', '-z']);
    const indexBefore = await git(repository, ['diff', '--cached', '--binary']);
    const branchesBefore = await git(repository, ['branch', '--list']);
    const fork = await forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'worktree' });
    const forkProject = (await runtime.workspaceProjects.getStatus(fork.workspaceId)).project!;
    const destination = forkProject.path!;
    expect(fork.projectId).toBe(project.id);
    expect(fork.workspaceId).toBe(forkProject.id);
    expect((await runtime.workspaceProjects.listProjects()).projects).toEqual([project]);
    const events = await runtime.threadStore.listEvents(fork.id);
    const replayed = events.reduce(applyRuntimeEventToThread, { ...fork, workspaceId: undefined, messages: [], lastSeq: 0 });
    expect(replayed.workspaceId).toBe(fork.workspaceId);
    expect(destination).not.toBe(repository);
    expect(await readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('unstaged\n');
    expect(await readFile(path.join(destination, 'binary.dat'))).toEqual(binary);
    expect(await readFile(path.join(destination, 'new dir', '你好.txt'), 'utf8')).toBe('untracked');
    await expect(access(path.join(destination, 'deleted.txt'))).rejects.toThrow();
    await expect(access(path.join(destination, 'ignored.txt'))).rejects.toThrow();
    expect((await git(destination, ['branch', '--show-current'])).trim()).toBe('');
    expect(await git(repository, ['branch', '--list'])).toBe(branchesBefore);
    expect(await git(destination, ['rev-parse', 'HEAD'])).toBe(await git(repository, ['rev-parse', 'HEAD']));
    expect(await git(repository, ['status', '--porcelain=v1', '-z'])).toBe(statusBefore);
    expect(await git(repository, ['diff', '--cached', '--binary'])).toBe(indexBefore);
    expect((await runtime.environmentResolver.resolve({ threadId: fork.id, projectId: fork.projectId, workspaceId: fork.workspaceId })).cwd).toBe(await realpath(destination));
    await runtime.workspaceProjects.writeFile(fork.workspaceId!, 'tracked.txt', 'fork only\n');
    expect(await readFile(path.join(repository, 'tracked.txt'), 'utf8')).toBe('unstaged\n');
    const sameWorkspace = await forkRuntimeThread(runtime, fork.id, { messageId: 'answer', target: 'workspace' });
    expect(sameWorkspace).toMatchObject({ projectId: project.id, workspaceId: fork.workspaceId });
    const side = await createRuntimeSideConversation(createSideConversationRuntimeHost(runtime), fork.id);
    expect(side).toMatchObject({ projectId: project.id, workspaceId: fork.workspaceId });
    await closeRuntime();
    runtime = createRuntimeFactory({ dataDir: path.join(root, 'data'), nativeBridge: new InMemoryDesktopNativeBridge() });
    await runtime.threadStore.recover();
    expect((await runtime.threadStore.getThread(fork.id))?.workspaceId).toBe(fork.workspaceId);
    expect((await runtime.workspaceProjects.getStatus(fork.workspaceId)).project?.path).toBe(destination);
    await deleteRuntimeThread(runtime, source.id);
    await deleteRuntimeThread(runtime, fork.id);
    expect(await readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('fork only\n');
  });

  it('forks a subdirectory of an existing linked worktree and rolls back Git, workspace and thread state on copy failure', async () => {
    const repository = await createRepository(root);
    const linked = path.join(root, 'linked');
    await git(repository, ['worktree', 'add', '--detach', linked]);
    await mkdir(path.join(linked, 'subdirectory'));
    await writeFile(path.join(linked, 'subdirectory', 'new.txt'), 'linked state');
    const project = await runtime.workspaceProjects.addProject({ path: path.join(linked, 'subdirectory') });
    const source = await runtime.threadStore.createThread({ projectId: project.id });
    await append(source, 'answer', 'assistant');
    const fork = await forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'worktree' });
    const destination = (await runtime.workspaceProjects.getStatus(fork.workspaceId)).project!.path!;
    expect(path.basename(destination)).toBe('subdirectory');
    expect(await readFile(path.join(destination, 'new.txt'), 'utf8')).toBe('linked state');
    const worktreesBefore = await git(repository, ['worktree', 'list', '--porcelain']);
    const branchesBefore = await git(repository, ['branch', '--list']);
    const projectsBefore = await runtime.workspaceProjects.listProjects();
    const threadsBefore = await runtime.threadStore.listThreads();
    vi.spyOn(runtime.attachmentStore, 'retainForThread').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'worktree' })).rejects.toThrow('storage unavailable');
    expect(await git(repository, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);
    expect(await git(repository, ['branch', '--list'])).toBe(branchesBefore);
    expect(await runtime.workspaceProjects.listProjects()).toEqual(projectsBefore);
    expect(await runtime.threadStore.listThreads()).toEqual(threadsBefore);
    expect(await readdir(path.join(runtime.dataDir, 'worktrees'))).toHaveLength(2);
  });

  it('rejects a missing boundary, active turn and non-Git worktree before creating another thread', async () => {
    const source = await runtime.threadStore.createThread();
    await append(source, 'answer', 'assistant');
    await expect(forkRuntimeThread(runtime, source.id, { messageId: 'missing', target: 'workspace' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'worktree' })).rejects.toMatchObject({ code: 'invalid_request' });
    vi.spyOn(runtime.agentLoop, 'activeTurnId').mockReturnValue('active');
    await expect(forkRuntimeThread(runtime, source.id, { messageId: 'answer', target: 'workspace' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await runtime.threadStore.listThreads()).toHaveLength(1);
    expect((await runtime.workspaceProjects.listProjects()).projects).toEqual([]);
  });
});

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

async function createRepository(root: string): Promise<string> {
  const directory = path.join(root, 'repository');
  await mkdir(directory);
  await git(directory, ['init']);
  await git(directory, ['config', 'user.name', 'Fork test']);
  await git(directory, ['config', 'user.email', 'fork@example.invalid']);
  await git(directory, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(directory, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(directory, 'tracked.txt'), 'original\n');
  await writeFile(path.join(directory, 'deleted.txt'), 'delete me\n');
  await writeFile(path.join(directory, 'binary.dat'), Buffer.from([0, 1, 2, 0]));
  await git(directory, ['add', '.']);
  await git(directory, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial']);
  return directory;
}
