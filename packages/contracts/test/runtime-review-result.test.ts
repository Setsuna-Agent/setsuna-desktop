import { describe, expect, it } from 'vitest';
import {
  normalizeRuntimeReviewNotice,
  parseRuntimeReviewResult,
} from '../src/threads.js';

describe('parseRuntimeReviewResult', () => {
  it('extracts localized findings and minimal line ranges', () => {
    expect(parseRuntimeReviewResult([
      '发现 2 个需要修复的问题。',
      '',
      '[P1] 结构化复制不能吞掉换行 — apps/desktop/renderer/src/chat.ts:211',
      '清理函数删除换行后会合并两个 token。',
      '',
      '[P2] 旧插件 ID 没有迁移 — packages/runtime/src/plugin.ts:25-29',
      '历史记录仍然引用旧 ID。',
    ].join('\n'))).toEqual({
      summary: '发现 2 个需要修复的问题。',
      findings: [
        {
          priority: 'P1',
          title: '结构化复制不能吞掉换行',
          path: 'apps/desktop/renderer/src/chat.ts',
          startLine: 211,
          body: '清理函数删除换行后会合并两个 token。',
        },
        {
          priority: 'P2',
          title: '旧插件 ID 没有迁移',
          path: 'packages/runtime/src/plugin.ts',
          startLine: 25,
          endLine: 29,
          body: '历史记录仍然引用旧 ID。',
        },
      ],
    });
  });

  it('keeps an unstructured provider response as the summary', () => {
    expect(parseRuntimeReviewResult('No actionable findings.')).toEqual({
      findings: [],
      summary: 'No actionable findings.',
    });
  });

  it('extracts a repository location from a Markdown-linked finding header', () => {
    expect(parseRuntimeReviewResult([
      '审查完成，发现一个问题。',
      '',
      '**[P1] 非流式路径会重复显示 reasoning — [chatAssistantTimeline.ts:205](apps/desktop/renderer/src/features/chat/conversation/chatAssistantTimeline.ts:205)**',
      '同一段 reasoning 会同时出现在思考面板和正文中。',
    ].join('\n'))).toEqual({
      summary: '审查完成，发现一个问题。',
      findings: [{
        priority: 'P1',
        title: '非流式路径会重复显示 reasoning',
        path: 'apps/desktop/renderer/src/features/chat/conversation/chatAssistantTimeline.ts',
        startLine: 205,
        body: '同一段 reasoning 会同时出现在思考面板和正文中。',
      }],
    });
  });

  it('uses a Markdown link label when a GitHub target encodes the line as a fragment', () => {
    expect(parseRuntimeReviewResult([
      '审查完成，发现一个问题。',
      '',
      '[P2] 评论卡片不能丢失 — [packages/contracts/src/threads.ts:260](https://github.com/org/repo/blob/rev/packages/contracts/src/threads.ts#L260)',
      '应当从可读标签恢复文件位置。',
    ].join('\n'))).toEqual({
      summary: '审查完成，发现一个问题。',
      findings: [{
        priority: 'P2',
        title: '评论卡片不能丢失',
        path: 'packages/contracts/src/threads.ts',
        startLine: 260,
        body: '应当从可读标签恢复文件位置。',
      }],
    });
  });

  it('does not let a later location overwrite a Markdown-linked finding target', () => {
    expect(parseRuntimeReviewResult(
      '[P2] Keep linked location — [src/a.ts:42](https://host/a#L42), related.ts:7',
    ).findings[0]).toMatchObject({
      path: 'src/a.ts',
      startLine: 42,
    });
  });

  it('keeps scanning for a location after a descriptive Markdown link', () => {
    expect(parseRuntimeReviewResult(
      '[P2] Issue — [context](https://tracker/item), src/a.ts:42',
    ).findings[0]).toMatchObject({
      title: 'Issue',
      path: 'src/a.ts',
      startLine: 42,
    });
  });

  it('does not split a title that quotes the finding delimiter', () => {
    expect(parseRuntimeReviewResult([
      '[P3] 解析器对标题内含 " — " 的 finding 误切分 — packages/runtime/src/review.ts:42',
      '标题必须保持完整。',
    ].join('\n')).findings[0]).toMatchObject({
      title: '解析器对标题内含 " — " 的 finding 误切分',
      path: 'packages/runtime/src/review.ts',
      startLine: 42,
    });
  });

  it('keeps malformed Markdown-link candidates on a linear scan', () => {
    const malformedCandidates = '候选 — [missing '.repeat(10_000);
    const finding = parseRuntimeReviewResult(
      `[P2] ${malformedCandidates}最终问题 — packages/runtime/src/review.ts:42`,
    ).findings[0];

    expect(finding).toMatchObject({
      path: 'packages/runtime/src/review.ts',
      startLine: 42,
    });
  });

  it('reparses persisted findings after parser fixes', () => {
    const notice = normalizeRuntimeReviewNotice({
      kind: 'exited',
      review: '[P3] 解析器对标题内含 " — " 的 finding 误切分 — packages/runtime/src/review.ts:44\n正文',
      findings: [{
        priority: 'P3',
        title: '解析器对标题内含 "',
        body: '正文',
        path: '" 的 finding 误切分 — packages/runtime/src/review.ts',
        startLine: 44,
      }],
    });

    expect(notice.findings?.[0]).toMatchObject({
      title: '解析器对标题内含 " — " 的 finding 误切分',
      path: 'packages/runtime/src/review.ts',
      startLine: 44,
    });
  });

  it('ignores legacy thinking and accepts markdown-formatted finding headers', () => {
    expect(parseRuntimeReviewResult([
      '<think>[P1] internal draft — src/internal.ts:1</think>',
      '本轮发现两个问题。',
      '',
      '**[P2] 键盘监听吞掉 Enter — `src/games/Minesweeper.tsx`:84-117**',
      '按钮无法通过键盘触发。',
      '',
      '**[P3] 核心逻辑缺少测试 — src/games/useMinesweeper.ts:226（reducer 整体），src/stats.ts:41-51**',
      '新增逻辑没有回归测试。',
    ].join('\n'))).toEqual({
      summary: '本轮发现两个问题。',
      findings: [
        {
          priority: 'P2',
          title: '键盘监听吞掉 Enter',
          path: 'src/games/Minesweeper.tsx',
          startLine: 84,
          endLine: 117,
          body: '按钮无法通过键盘触发。',
        },
        {
          priority: 'P3',
          title: '核心逻辑缺少测试',
          path: 'src/games/useMinesweeper.ts',
          startLine: 226,
          body: '新增逻辑没有回归测试。',
        },
      ],
    });

    expect(parseRuntimeReviewResult('<think>internal review only')).toEqual({
      findings: [],
      summary: '',
    });
  });

  it('preserves literal think tags after the provider boundary separated reasoning', () => {
    const review = [
      'Review discusses <think>literal summary</think> markup.',
      '',
      '[P2] Preserve protocol examples — packages/contracts/src/threads.ts:179',
      'Keep <think>literal body</think> in the visible review.',
    ].join('\n');
    const expected = {
      summary: 'Review discusses <think>literal summary</think> markup.',
      findings: [{
        priority: 'P2' as const,
        title: 'Preserve protocol examples',
        path: 'packages/contracts/src/threads.ts',
        startLine: 179,
        body: 'Keep <think>literal body</think> in the visible review.',
      }],
    };

    expect(parseRuntimeReviewResult(review, { legacyThinkTags: false })).toEqual(expected);
    expect(normalizeRuntimeReviewNotice({
      kind: 'exited',
      reasoningSeparated: true,
      review,
    })).toEqual({
      kind: 'exited',
      reasoningSeparated: true,
      review,
      ...expected,
    });
  });
});
