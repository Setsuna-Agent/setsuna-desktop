const WINDOWS_RESERVED_FILE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export function replaceControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? replacement : character;
  }).join('');
}

/** Produces a cross-platform-safe stem for files owned by runtime storage. */
export function safeStorageFileStem(value: string, fallback: string): string {
  const stem = replaceControlCharacters(value, '_')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 120) || fallback;
  return WINDOWS_RESERVED_FILE_STEM.test(stem) ? `_${stem}` : stem;
}
