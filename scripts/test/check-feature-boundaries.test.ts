import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The production checker is a plain ESM script executed directly by Node.
import { checkFeatureBoundaries } from '../check-feature-boundaries.mjs';

describe('Feature boundary checker', () => {
  it('rejects concrete Feature imports from newly added files in frozen central zones', async () => {
    await withFixture({
      'apps/desktop/renderer/src/features/settings/new-memory-settings.ts': `
        import type { MemoryPreferences } from '@setsuna-desktop/feature-memory/contracts';
        export type LeakedSettings = MemoryPreferences;
      `,
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'central host code cannot import concrete Feature "@setsuna-desktop/feature-memory/contracts"',
      ));
    });
  });

  it('rejects renderer raw transport and cross-Feature implementation imports', async () => {
    await withFixture({
      'packages/features/memory/src/renderer/raw-client.ts': `
        export const load = () => fetch('/v1/features/memory');
      `,
      'packages/features/memory/src/runtime/cross-feature.ts': `
        import '@setsuna-desktop/feature-other/runtime';
      `,
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining('renderer Feature must use its injected typed transport'));
      expect(violations).toContainEqual(expect.stringContaining('Features may import another Feature only through its /contracts entry'));
    });
  });

  it('does not infer Feature ownership from ordinary identifiers or copy', async () => {
    await withFixture({
      'apps/desktop/renderer/src/features/settings/SettingsPage.tsx': `
        export const goalSummary = 'Memory pressure is within normal limits.';
      `,
    }, async (root) => {
      await expect(checkFeatureBoundaries(root)).resolves.toEqual([]);
    });
  });

  it('rejects duplicate persisted Feature identities across packages', async () => {
    await withFixture({
      'packages/features/other/package.json': JSON.stringify({
        name: '@setsuna-desktop/feature-other',
        version: '0.1.0',
        exports: { './contracts': './dist/contracts/index.js' },
      }),
      'packages/features/other/src/contracts/definition.ts': `
        import { defineFeature } from '@setsuna-desktop/feature-core/definition';
        export const otherFeature = defineFeature('memory');
      `,
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'Feature identity "memory" is already declared by',
      ));
    });
  });

  it('requires process source entries and package exports to stay symmetric', async () => {
    await withFixture({
      'packages/features/memory/src/main/index.ts': 'export const mainContribution = true;',
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'Feature source entry "main" must have a matching "./main" package export',
      ));
    });
  });

  it('requires exactly one composition root per host process', async () => {
    await withFixture({
      'packages/desktop-runtime/src/composition/second-root.ts': `
        import { defineRuntimeFeatureHost } from '@setsuna-desktop/feature-core/runtime';
        export const duplicate = defineRuntimeFeatureHost({ required: [], optional: [] });
      `,
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'runtime host must contain exactly one defineRuntimeFeatureHost() composition root; found 2',
      ));
    });
  });

  it('keeps concrete Feature implementation imports behind host composition adapters', async () => {
    await withFixture({
      'apps/desktop/renderer/src/features/chat/leaked-view.ts': `
        import '@setsuna-desktop/feature-memory/renderer';
      `,
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'concrete Feature implementation import "@setsuna-desktop/feature-memory/renderer" must be isolated under the renderer composition directory',
      ));
    });
  });

  it('requires the workspace Feature build command and a standard package build script', async () => {
    await withFixture({
      'package.json': JSON.stringify({
        scripts: { 'build:features': '' },
        dependencies: {},
      }),
      'packages/features/memory/package.json': JSON.stringify({
        name: '@setsuna-desktop/feature-memory',
        version: '0.1.0',
        exports: { './contracts': './dist/contracts/index.js' },
      }),
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'build:features must use the workspace Feature build command',
      ));
      expect(violations).toContainEqual(expect.stringContaining(
        'Feature package build script must be "tsc -b tsconfig.build.json"',
      ));
    });
  });

  it('rejects stale runtime build references after a Feature package is removed', async () => {
    await withFixture({
      'packages/desktop-runtime/tsconfig.build.json': JSON.stringify({
        references: [{ path: '../features/removed/tsconfig.build.json' }],
      }),
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'stale runtime references entry "packages/features/removed/tsconfig.build.json" has no Feature package',
      ));
    });
  });

  it('rejects stale renderer build entries after a Feature renderer entry is removed', async () => {
    await withFixture({
      'tsconfig.renderer.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@setsuna-desktop/feature-memory/*': ['packages/features/memory/src/*'],
          },
        },
        references: [{ path: './packages/features/memory/tsconfig.build.json' }],
      }),
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'renderer Feature "@setsuna-desktop/feature-memory" must not retain a build reference without a renderer source entry',
      ));
      expect(violations).toContainEqual(expect.stringContaining(
        'renderer Feature alias "@setsuna-desktop/feature-memory/*" must not exist without a renderer source entry',
      ));
    });
  });

  it('requires runtime source entries in the runtime project reference graph', async () => {
    await withFixture({
      'packages/features/memory/package.json': JSON.stringify({
        name: '@setsuna-desktop/feature-memory',
        version: '0.1.0',
        exports: {
          './contracts': './dist/contracts/index.js',
          './runtime': './dist/runtime/index.js',
        },
        scripts: { build: 'tsc -b tsconfig.build.json' },
      }),
      'packages/features/memory/src/runtime/index.ts': 'export const runtimeContribution = true;',
      'packages/desktop-runtime/package.json': JSON.stringify({
        dependencies: { '@setsuna-desktop/feature-memory': 'workspace:*' },
      }),
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'runtime Feature "@setsuna-desktop/feature-memory" must have one build reference',
      ));
    });
  });

  it('rejects stale host dependencies after their process entries are removed', async () => {
    await withFixture({
      'package.json': JSON.stringify({
        scripts: {
          'build:features': 'pnpm --recursive --filter "./packages/features/*" run build',
        },
        dependencies: {
          '@setsuna-desktop/feature-memory': 'workspace:*',
        },
      }),
      'packages/desktop-runtime/package.json': JSON.stringify({
        dependencies: {
          '@setsuna-desktop/feature-memory': 'workspace:*',
        },
      }),
    }, async (root) => {
      const violations = await checkFeatureBoundaries(root);
      expect(violations).toContainEqual(expect.stringContaining(
        'desktop host must not depend on "@setsuna-desktop/feature-memory" without a renderer, main, or preload source entry',
      ));
      expect(violations).toContainEqual(expect.stringContaining(
        'runtime host must not depend on "@setsuna-desktop/feature-memory" without a runtime source entry',
      ));
    });
  });
});

async function withFixture(
  additions: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-feature-boundaries-'));
  try {
    await writeFiles(root, {
      'package.json': JSON.stringify({
        scripts: {
          'build:features': 'pnpm --recursive --filter "./packages/features/*" run build',
        },
        dependencies: {},
      }),
      'tsconfig.json': JSON.stringify({
        references: [{ path: './packages/features/memory/tsconfig.build.json' }],
      }),
      'tsconfig.renderer.json': JSON.stringify({
        compilerOptions: { paths: {} },
        references: [],
      }),
      'packages/desktop-runtime/package.json': JSON.stringify({ dependencies: {} }),
      'packages/desktop-runtime/tsconfig.build.json': JSON.stringify({ references: [] }),
      'packages/features/memory/package.json': JSON.stringify({
        name: '@setsuna-desktop/feature-memory',
        version: '0.1.0',
        exports: {
          './contracts': './dist/contracts/index.js',
        },
        scripts: { build: 'tsc -b tsconfig.build.json' },
      }),
      'packages/features/memory/tsconfig.build.json': JSON.stringify({ files: [] }),
      'packages/features/memory/src/contracts/definition.ts': `
        import { defineFeature } from '@setsuna-desktop/feature-core/definition';
        export const memoryFeature = defineFeature('memory');
      `,
      'apps/desktop/main/src/composition/root.ts': `
        import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
        export const root = defineMainFeatureHost({ required: [], optional: [] });
      `,
      'apps/desktop/preload/src/composition/root.ts': `
        import { definePreloadFeatureHost } from '@setsuna-desktop/feature-core/preload';
        export const root = definePreloadFeatureHost({ bridgeKeys: [], features: [] });
      `,
      'apps/desktop/renderer/src/composition/root.ts': `
        import { defineRendererFeatureHost } from '@setsuna-desktop/feature-core/renderer';
        export const root = defineRendererFeatureHost({ required: [], optional: [] });
      `,
      'packages/desktop-runtime/src/composition/root.ts': `
        import { defineRuntimeFeatureHost } from '@setsuna-desktop/feature-core/runtime';
        export const root = defineRuntimeFeatureHost({ required: [], optional: [] });
      `,
      ...additions,
    });
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content.trimStart(), 'utf8');
  }
}
