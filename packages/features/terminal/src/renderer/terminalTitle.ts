const TERMINAL_TITLE_MAX_LENGTH = 160;

export function terminalDisplayTitle(title: string, shell: string): string {
  const normalized = replaceControlCharacters(title)
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || shell).slice(0, TERMINAL_TITLE_MAX_LENGTH);
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('');
}
