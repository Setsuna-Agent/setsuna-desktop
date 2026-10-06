type BrandName = Readonly<{ key: string; label: string; searchText?: string }>;
type BrandAliases = Readonly<{ key: string; names: readonly string[] }>;

export function createBrandNameMatcher(
  catalog: readonly BrandName[],
  aliases: readonly BrandAliases[],
): (value: string) => string | null {
  // Existing aliases win ties; longer names distinguish brands such as Claude Code and Claude.
  const candidates = [
    ...aliases.flatMap(({ key, names }) => names.map((name) => ({ key, name }))),
    ...catalog.flatMap((brand) => catalogNames(brand).map((name) => ({ key: brand.key, name }))),
  ];
  const seen = new Set<string>();
  const patterns = candidates.flatMap(({ key, name }) => {
    const normalized = normalizeName(name);
    const identity = `${key}:${normalized}`;
    if (!normalized || seen.has(identity)) return [];
    seen.add(identity);
    const length = normalized.replace(/\s+/gu, '').length;
    const start = /^[a-z0-9]/u.test(normalized) ? '(?:^|[^a-z0-9])' : '';
    // Model versions may be attached to a brand (Qwen3); Latin suffixes are not matches.
    const end = /[a-z0-9]$/u.test(normalized)
      ? (length >= 3 && /[a-z]$/u.test(normalized) ? '(?=$|[^a-z])' : '(?=$|[^a-z0-9])')
      : '';
    const pattern = new RegExp(`${start}${normalized.split(' ').join('\\s*')}${end}`, 'u');
    return [{ key, length, pattern }];
  }).sort((left, right) => right.length - left.length);

  return (value) => {
    const normalized = normalizeName(value);
    return patterns.find(({ pattern }) => pattern.test(normalized))?.key ?? null;
  };
}

function catalogNames({ key, label, searchText = '' }: BrandName): string[] {
  const names = [key, label, searchText.split('(')[0]];
  // Parentheses often name the owner ("Gemma (Google)"), not an alias for the mark.
  // Chinese names are useful localized aliases; existing English aliases are supplied explicitly.
  const localizedNames = [...searchText.matchAll(/\(([^)]+)\)/gu)]
    .flatMap((match) => match[1]!.split(/[/、,]/u))
    .filter((name) => /\p{Script=Han}/u.test(name));
  return [...names, ...names.map((name) => name.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')), ...localizedNames];
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
