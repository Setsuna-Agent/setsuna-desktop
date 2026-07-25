import { describe, expect, it } from 'vitest';
import { resolveMainWindowSurfaceOptions } from '../../../src/window/surface.js';

describe('main window surface options', () => {
  it('uses an opaque native surface on Windows', () => {
    expect(resolveMainWindowSurfaceOptions('win32')).toEqual({
      transparent: false,
      backgroundColor: '#f7f6fa',
    });
  });

  it('preserves the existing Linux transparent custom-frame surface', () => {
    expect(resolveMainWindowSurfaceOptions('linux')).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
    });
  });

  it('preserves the existing macOS non-transparent surface', () => {
    expect(resolveMainWindowSurfaceOptions('darwin')).toEqual({
      transparent: false,
      backgroundColor: '#00000000',
    });
  });
});
