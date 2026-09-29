import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import type { SkillsTranslate } from './messages.js';

export const skillDirectoryPresets = [
  { id: 'global', labelKey: 'feature.skills.directory.global', homeRelativePath: ['.agents', 'skills'] },
  { id: 'codex', labelKey: 'feature.skills.directory.codex', homeRelativePath: ['.codex', 'skills'] },
  { id: 'claude', labelKey: 'feature.skills.directory.claude', homeRelativePath: ['.claude', 'skills'] },
  { id: 'grok', labelKey: 'feature.skills.directory.grok', homeRelativePath: ['.grok', 'skills'] },
  { id: 'pi', labelKey: 'feature.skills.directory.pi', homeRelativePath: ['.pi', 'agent', 'skills'] },
] as const;

type SkillCatalogGroup = {
  id: string;
  title: string;
  skills: RuntimeSkillSummary[];
};

export function groupSkillsBySource(
  skills: readonly RuntimeSkillSummary[],
  extraRoots: readonly string[],
  translate: SkillsTranslate,
): SkillCatalogGroup[] {
  const nativeGroups: Record<RuntimeSkillSummary['kind'], SkillCatalogGroup> = {
    user: { id: 'user', title: translate('feature.skills.category.user'), skills: [] },
    plugin: { id: 'plugin', title: translate('feature.skills.category.plugin'), skills: [] },
    builtin: { id: 'builtin', title: translate('feature.skills.category.builtin'), skills: [] },
  };
  const uniqueRoots = new Map(extraRoots.map((root) => [normalizeCatalogPath(root), root]));
  const directories = [...uniqueRoots].map(([root, displayPath]) => {
    const preset = skillDirectoryPresets.find((entry) => root.endsWith(`/${entry.homeRelativePath.join('/')}`));
    const group: SkillCatalogGroup = {
      id: `directory:${root}`,
      title: preset ? translate(preset.labelKey) : displayPath,
      skills: [],
    };
    return { root, group };
  });
  // Prefer the closest configured directory when inherited roots overlap.
  const matchingDirectories = [...directories].sort((left, right) => right.root.length - left.root.length);

  for (const skill of skills) {
    const skillPath = skill.path ? normalizeCatalogPath(skill.path) : '';
    // Inherited skills keep their runtime kind; only the catalog separates their source.
    const directory = skill.kind === 'user'
      ? matchingDirectories.find(({ root }) => skillPath.startsWith(`${root}/`))
      : undefined;
    (directory?.group ?? nativeGroups[skill.kind]).skills.push(skill);
  }

  return [nativeGroups.user, ...directories.map(({ group }) => group), nativeGroups.plugin, nativeGroups.builtin]
    .filter(({ skills }) => skills.length > 0);
}

function normalizeCatalogPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
  // Runtime paths are already absolute and resolved; Windows comparisons also ignore case.
  return /^(?:[a-z]:|\/\/)/iu.test(normalized) ? normalized.toLowerCase() : normalized;
}
