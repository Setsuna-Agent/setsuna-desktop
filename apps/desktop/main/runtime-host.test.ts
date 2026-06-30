import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePackagedRuntimeEntry, resolveRuntimeSpawnCwd } from './runtime-host.js';

describe('runtime host packaging paths', () => {
  it('uses a real directory for the runtime child process cwd when packaged in asar', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(path.join('/Applications/Setsuna Desktop.app/Contents/Resources'));
  });

  it('keeps the source app root as cwd during local development', () => {
    const appRoot = '/Users/zy/Documents/setsuna-desktop';

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(appRoot);
  });

  it('points packaged runtime startup at the CommonJS bundle', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolvePackagedRuntimeEntry(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/dist/runtime/cli.cjs'),
    );
  });
});
