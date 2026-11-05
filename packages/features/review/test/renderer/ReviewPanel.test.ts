import { describe, expect, it } from 'vitest';
import {
  branchCompareRefOptions,
  consumeReviewFocusRequest, reviewWorkspaceFilePath
} from '../../src/renderer/ReviewPanel.js';

describe('DesktopReviewPanel', () => {

  it('consumes automatic file focus once so manual source selection is not reverted', () => {
    const firstFocus = consumeReviewFocusRequest(null, 'project_1:Tile.tsx:1', 'unstaged');
    expect(firstFocus).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:1',
      shouldApply: true,
    });

    expect(consumeReviewFocusRequest(
      firstFocus.nextHandledRequestKey,
      'project_1:Tile.tsx:1',
      'unstaged',
    )).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:1',
      shouldApply: false,
    });

    expect(consumeReviewFocusRequest(
      firstFocus.nextHandledRequestKey,
      'project_1:Tile.tsx:2',
      'staged',
    )).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:2',
      shouldApply: true,
    });
  });

  it('deduplicates local and remote branch compare refs with remote refs preferred', () => {
    expect(branchCompareRefOptions([
      'origin/master',
      'master',
      'origin',
      'origin/setsuna/temp',
      'setsuna/temp',
      'temp',
    ])).toEqual([
      { value: 'origin/master', label: 'origin/master' },
      { value: 'origin/setsuna/temp', label: 'origin/setsuna/temp' },
      { value: 'temp', label: 'temp' },
    ]);
  });

  it('maps git review paths back to the active project root', () => {
    const context = {
      source: 'unstaged' as const,
      workspaceRoot: '/Users/zy/work/yuri/front-end/agent',
      gitRoot: '/Users/zy/work/yuri',
    };

    expect(reviewWorkspaceFilePath('front-end/agent/vite.config.ts', context)).toBe('vite.config.ts');
    expect(reviewWorkspaceFilePath('front-end/agent/src/main.ts', context)).toBe('src/main.ts');
    expect(reviewWorkspaceFilePath('front-end/package.json', context)).toBeNull();
  });

  it('keeps latest assistant file changes project-relative', () => {
    expect(reviewWorkspaceFilePath('src/domain/agent/App.vue', {
      source: 'latest',
      workspaceRoot: '/Users/zy/work/yuri/front-end/agent',
      gitRoot: '/Users/zy/work/yuri',
    })).toBe('src/domain/agent/App.vue');
  });

  it('normalizes long slash runs while preserving the workspace boundary', () => {
    const slashes = '/'.repeat(100_000);
    const context = {
      source: 'unstaged' as const,
      workspaceRoot: `/repo${slashes}project${slashes}`,
      gitRoot: `/repo${slashes}`,
    };
    expect(reviewWorkspaceFilePath('project/src/app.ts', context)).toBe('src/app.ts');
    expect(reviewWorkspaceFilePath('sibling/secret.txt', context)).toBeNull();
    expect(reviewWorkspaceFilePath('src/app.ts', {
      source: 'unstaged',
      workspaceRoot: 'C:\\repo\\project\\',
      gitRoot: 'c:\\repo\\project',
    })).toBe('src/app.ts');
  });

});
