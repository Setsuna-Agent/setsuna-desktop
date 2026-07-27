import { describe, expect, it } from 'vitest';
import { errorMessage, isNodeError, isNodeErrorCode } from '../../src/shared/node-errors.js';

describe('node error helpers', () => {
  it('normalizes unknown error messages', () => {
    expect(errorMessage(new Error('failed'))).toBe('failed');
    expect(errorMessage('failed')).toBe('failed');
  });

  it('recognizes Node errors and their codes without accepting arbitrary objects', () => {
    const nodeError = Object.assign(new Error('missing'), { code: 'ENOENT' });

    expect(isNodeError(nodeError)).toBe(true);
    expect(isNodeErrorCode(nodeError, 'ENOENT')).toBe(true);
    expect(isNodeErrorCode(nodeError, 'EACCES')).toBe(false);
    expect(isNodeErrorCode({ code: 'ENOENT' }, 'ENOENT')).toBe(false);
  });
});
