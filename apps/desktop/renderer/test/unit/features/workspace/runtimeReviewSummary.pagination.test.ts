import { FILE_DIFF_PREVIEW_LINES, projectFileChangePreview, projectMessageFilePreviews, projectMessagePageFileChanges, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { conversationOverviewFromMessages } from '../../../../src/features/chat/conversation/chatConversationOverview.js';
import { latestDesktopReviewSummaryFromMessages, scopeReviewSummary } from '../../../../src/features/workspace/runtimeReviewSummary.js';
import { createReviewFileChangePreviewLoader } from '../../../../src/features/workspace/reviewFileChangePreview.js';

it.each([false, true])('loads a later patch file cut from the current page after merging operations (index: %s)', async (withIndex) => {
  const messages: RuntimeMessage[] = [{ id: 'message', role: 'assistant', turnId: 'turn', content: '', createdAt: '',
    toolRuns: [{ id: 'patch', name: 'apply_patch', status: 'success', data: { diff: { type: 'patch_diff', diffs: [
      { type: 'file_diff', path: 'first.ts', additions: FILE_DIFF_PREVIEW_LINES, deletions: 0,
        lines: Array.from({ length: FILE_DIFF_PREVIEW_LINES }, (_, index) => ({ type: 'add', newLine: index + 1, content: 'first' })) },
      { type: 'file_diff', path: 'second.ts', additions: 1, deletions: 1,
        lines: [{ type: 'del', oldLine: 1, content: 'before' }, { type: 'add', newLine: 1, content: 'after' }] },
    ] } } }],
  }];
  messages[0].toolRuns![0].resultPreview = JSON.stringify(messages[0].toolRuns![0].data);
  const page = projectMessagePageFileChanges(messages, { messages, total: 1, nextBefore: null });
  const displayed = page.messages.map((message) => projectMessageFilePreviews(message));
  const summary = latestDesktopReviewSummaryFromMessages(displayed, withIndex ? page.fileChangeGroups : undefined, 'thread');
  const file = summary!.files.find((item) => item.path === 'second.ts')!;
  expect(file).toMatchObject({ lines: [], truncated: true,
    changeReference: { threadId: 'thread', path: 'second.ts', toolCallIds: ['patch'] },
  });
  const load = createReviewFileChangePreviewLoader(() => ({
    getThreadFileChangePreview: async (_threadId, input) => projectFileChangePreview(messages, input),
  }));
  const preview = await load(file.changeReference!, new AbortController().signal);
  expect(preview).toMatchObject({ path: 'second.ts', additions: 1, deletions: 1, truncated: false,
    lines: [{ content: 'before' }, { content: 'after' }],
  });
  expect(JSON.stringify(preview)).not.toContain('first');
});

it.each(['long_turn', undefined])('keeps an early-only edit in overview and latest Review after paging (turnId: %s)', (turnId) => {
  const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
    id: `message_${index}`, turnId, role: index === 0 ? 'user' : 'assistant', content: `Progress ${index}`, createdAt: '',
    toolRuns: index === 1 ? [{ id: 'early_edit', name: 'edit', status: 'success', data: { diff: {
      type: 'file_diff', path: 'early.ts', absolutePath: '/repo/early.ts', additions: 1, deletions: 1,
      lines: [{ type: 'del', oldLine: 1, content: 'before' }, { type: 'add', newLine: 1, content: 'after' }],
    } } }] : [],
  }));
  const page = projectMessagePageFileChanges(messages, { messages: messages.slice(-160), total: 430, nextBefore: 270 });
  expect(conversationOverviewFromMessages(page.messages, null, page.fileChangeGroups).fileChangeSummary)
    .toMatchObject({ additions: 1, deletions: 1, files: [{ path: 'early.ts', lines: [] }] });
  const review = latestDesktopReviewSummaryFromMessages(page.messages, page.fileChangeGroups, 'thread');
  expect(review).toMatchObject({ additions: 1, deletions: 1, files: [{ path: '/repo/early.ts', lines: [],
    changeReference: { threadId: 'thread', path: '/repo/early.ts', toolCallIds: ['early_edit'] },
  }] });
  const scoped = scopeReviewSummary(review, { id: 'project', name: 'non-Git workspace', path: '/repo', roots: [{ id: 'root', path: '/repo' }], createdAt: '', updatedAt: '' }, 'root');
  expect(scoped?.files[0]).toMatchObject({ path: 'early.ts', changeReference: review?.files[0].changeReference });
  const fullPage = projectMessagePageFileChanges(messages, { messages, total: 430, nextBefore: null });
  const loaded = latestDesktopReviewSummaryFromMessages(fullPage.messages, fullPage.fileChangeGroups, 'thread');
  expect(loaded).toMatchObject({ additions: 1, deletions: 1, files: [{ path: '/repo/early.ts', lines: [{ content: 'before' }, { content: 'after' }] }] });
  expect(loaded?.files[0].changeReference).toBeUndefined();
});

it('uses only the latest run with file changes and includes every edit of its files', () => {
  const edit = (id: string, turnId: string, file: string): RuntimeMessage => ({ id, turnId, role: 'assistant', content: '', createdAt: '',
    toolRuns: [{ id, name: 'edit', status: 'success', data: { diff: { path: file, additions: 1, deletions: 0, lines: [{ type: 'add', newLine: 1, content: id }] } } }],
  });
  const messages: RuntimeMessage[] = [edit('old', 'old_turn', 'old.ts'), edit('early', 'turn', 'current.ts'),
    edit('late', 'turn', 'current.ts'), { id: 'tail', turnId: 'turn', role: 'assistant', content: 'Done', createdAt: '' }];
  const page = projectMessagePageFileChanges(messages, { messages: [messages[0], ...messages.slice(-2)], total: 4, nextBefore: null });
  expect(latestDesktopReviewSummaryFromMessages(page.messages, page.fileChangeGroups, 'thread')).toMatchObject({
    additions: 2, files: [{ path: 'current.ts', additions: 2, changeReference: { toolCallIds: ['early', 'late'] } }],
  });
  expect(conversationOverviewFromMessages(page.messages, null, page.fileChangeGroups).fileChangeSummary?.files).toHaveLength(1);
});
