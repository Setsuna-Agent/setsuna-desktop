import { describe, expect, it } from 'vitest';
import { createComposerDraftSyncPlan } from '../../../../../src/features/chat/composer/chatComposerDraftSync.js';

describe('createComposerDraftSyncPlan', () => {
  it('ignores the parent echo of an editor change', () => {
    expect(createComposerDraftSyncPlan('typed locally', 'typed locally', 'typed locally')).toEqual({ type: 'none' });
  });

  it('appends an external starter prompt to an empty editor', () => {
    expect(createComposerDraftSyncPlan('请帮我探索当前项目。', '', '')).toEqual({
      type: 'append',
      value: '请帮我探索当前项目。',
    });
  });

  it('adopts a draft that is already visible in the editor', () => {
    expect(createComposerDraftSyncPlan('visible draft', 'stale draft', 'visible draft')).toEqual({ type: 'adopt' });
  });

  it('appends external additions without rebuilding existing slots', () => {
    expect(createComposerDraftSyncPlan('/review existing draft\n@src/main.ts ', '/review existing draft', '/review existing draft')).toEqual({
      type: 'append',
      value: '\n@src/main.ts ',
    });
  });

  it('replaces the editor for an unrelated external draft', () => {
    expect(createComposerDraftSyncPlan('restored draft', 'old draft', 'old draft')).toEqual({
      type: 'replace',
      value: 'restored draft',
    });
  });

  it('clears the editor when the external draft is reset', () => {
    expect(createComposerDraftSyncPlan('', 'old draft', 'old draft')).toEqual({ type: 'replace', value: '' });
  });
});
