import { getSingularPatch, setLanguageOverride } from '@pierre/diffs';
import { preloadFileDiff } from '@pierre/diffs/ssr';
import { describe, expect, it } from 'vitest';
import { codeDiffLinesToPatch } from '../../../../src/shared/code/diffPatch.js';
import { inferPatchLanguageOverride } from '../../../../src/shared/code/patchLanguage.js';

describe('codeDiffLinesToPatch', () => {
  it('rebuilds separated retained lines as valid hunks with the real filename', () => {
    const patch = truncatedVuePatch();

    expect(patch).toContain('diff --git a/src/App.vue b/src/App.vue');
    expect(patch).toContain('@@ -20,2 +20,2 @@');
    expect(patch).toContain('@@ -40,1 +40,1 @@');
    expect(getSingularPatch(patch).name).toBe('src/App.vue');
  });

  it('keeps a contextless Vue script hunk syntax-highlighted after truncation', async () => {
    const patch = truncatedVuePatch();
    const parsed = getSingularPatch(patch);
    const language = inferPatchLanguageOverride(parsed.name, patch);

    expect(language).toBe('typescript');
    if (!language) throw new Error('Expected a language override for the truncated Vue script hunk.');
    const { prerenderedHTML } = await preloadFileDiff({
      fileDiff: setLanguageOverride(parsed, language),
      options: {
        diffIndicators: 'bars',
        lineDiffType: 'none',
        overflow: 'wrap',
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        themeType: 'light',
      },
    });
    const tokenColors = new Set(
      [...prerenderedHTML.matchAll(/--diffs-token-light:([^;"]+)/gu)].map((match) => match[1]),
    );

    expect(tokenColors.size).toBeGreaterThan(1);
    expect(prerenderedHTML).not.toContain('<span data-diff-span');
    expect(prerenderedHTML).toContain('data-line-type="change-addition"');
  });

  it('keeps the Vue grammar when the retained hunk contains an SFC boundary', () => {
    expect(inferPatchLanguageOverride('src/App.vue', [
      'diff --git a/src/App.vue b/src/App.vue',
      '--- a/src/App.vue',
      '+++ b/src/App.vue',
      '@@ -1,2 +1,2 @@',
      ' <script setup lang="ts">',
      '+const active = true;',
    ].join('\n'))).toBeUndefined();
  });
});

function truncatedVuePatch(): string {
  return codeDiffLinesToPatch({
    path: 'src/App.vue',
    action: 'Modified',
    lines: [
      { type: 'gap', content: '19 unmodified lines' },
      { type: 'context', oldLine: 20, newLine: 20, content: "import { confirmDelete } from '@/hooks/useSecondConfirm'" },
      { type: 'removed', oldLine: 21, content: "import { Delete, Edit } from '@element-plus/icons-vue'" },
      { type: 'added', newLine: 21, content: "import { Bottom, Delete, Edit } from '@element-plus/icons-vue'" },
      { type: 'gap', content: '18 unmodified lines' },
      { type: 'context', oldLine: 40, newLine: 40, content: 'const dialogVisible = ref(false);' },
    ],
  });
}
