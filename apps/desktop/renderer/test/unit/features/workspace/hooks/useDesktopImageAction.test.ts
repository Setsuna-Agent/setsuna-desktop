import { describe, expect, it } from 'vitest';
import { desktopImageActionSuccessMessage } from '../../../../../src/features/workspace/hooks/useDesktopImageAction.js';

describe('desktopImageActionSuccessMessage', () => {
  it('uses consistent success feedback for every image action entry point', () => {
    expect(desktopImageActionSuccessMessage('copy')).toBe('图片已复制');
    expect(desktopImageActionSuccessMessage('reveal')).toBe('已在文件夹中显示图片');
  });
});
