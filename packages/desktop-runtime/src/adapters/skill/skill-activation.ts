import type { RuntimePluginReference } from '@setsuna-desktop/contracts';

export type PluginSkillOrigin = {
  reference: RuntimePluginReference;
  description?: string;
  tags: string[];
};

export function inferredPluginActivationKeywords(
  skillId: string,
  skillName: string,
  description: string | undefined,
  pluginOrigin: PluginSkillOrigin,
): string[] {
  const plugin = pluginOrigin.reference;
  const metadataPhrases = [skillName, plugin.name, ...pluginOrigin.tags]
    .filter(meaningfulActivationPhrase);
  const identityPhrases = [skillId.split('.').at(-1), plugin.id];
  const highSignalNameTerms = latinTerms(`${skillName} ${plugin.name}`).filter((term) =>
    highSignalLatinTerm(term, 3),
  );
  const highSignalDescriptionTerms = latinTerms(
    [description, pluginOrigin.description].filter(Boolean).join(' '),
  ).filter((term) => highSignalLatinTerm(term, 4));
  return uniqueStrings([
    ...metadataPhrases,
    ...identityPhrases,
    ...highSignalNameTerms,
    ...highSignalDescriptionTerms,
  ]);
}

function highSignalLatinTerm(term: string, acronymMinLength: number): boolean {
  return /\d/u.test(term)
    || (term.length >= acronymMinLength && term === term.toUpperCase())
    || (term.length >= 4 && /[A-Z].*[A-Z]/u.test(term));
}

function meaningfulActivationPhrase(value: string | undefined): value is string {
  const normalized = value?.normalize('NFKC').trim();
  if (!normalized) return false;
  const cjkLength = [...normalized].filter((character) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)).length;
  return cjkLength === 0 ? normalized.replace(/\s+/gu, '').length >= 3 : cjkLength >= 3;
}

function latinTerms(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z0-9.+#_-]{1,}/g) ?? [];
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.normalize('NFKC').trim();
    const key = normalized?.toLocaleLowerCase('en-US');
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function pluginSkillMatchesActivation(skill: { kind: string; autoActivate: string[] }, activationText: string): boolean {
  if (skill.kind !== 'plugin' || !skill.autoActivate.length) return false;
  const text = activationText.normalize('NFKC').toLocaleLowerCase('en-US');
  return skill.autoActivate.some((keyword) => activationKeywordMatches(text, keyword));
}

function activationKeywordMatches(normalizedText: string, keyword: string): boolean {
  const normalizedKeyword = keyword.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!normalizedKeyword) return false;
  if (!/^[a-z0-9][a-z0-9.+#_-]*$/u.test(normalizedKeyword)) return normalizedText.includes(normalizedKeyword);
  let index = normalizedText.indexOf(normalizedKeyword);
  while (index !== -1) {
    const before = normalizedText[index - 1] ?? '';
    const after = normalizedText[index + normalizedKeyword.length] ?? '';
    if (!/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after)) return true;
    index = normalizedText.indexOf(normalizedKeyword, index + normalizedKeyword.length);
  }
  return false;
}
