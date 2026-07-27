import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  directoriesFromRoot,
  pathIsWithin,
  truncateUtf8,
} from '../../../src/adapters/workspace/workspace-discovery-utils.js';

describe('workspace discovery helpers', () => {
  it('walks from the workspace root to the selected cwd', () => {
    const root = path.resolve('workspace');
    const child = path.join(root, 'packages', 'app');

    expect(directoriesFromRoot(root, child)).toEqual([
      root,
      path.join(root, 'packages'),
      child,
    ]);
  });

  it('distinguishes contained paths from parent and sibling paths', () => {
    const root = path.resolve('workspace');

    expect(pathIsWithin(root, root)).toBe(true);
    expect(pathIsWithin(root, path.join(root, 'src'))).toBe(true);
    expect(pathIsWithin(root, path.resolve(root, '..', 'other'))).toBe(false);
  });

  it('honors UTF-8 byte limits when truncating prompt text', () => {
    const truncated = truncateUtf8('alpha beta gamma', 10);

    expect(truncated).toBe('alpha beta');
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(10);
  });
});
