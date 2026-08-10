const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*]/u;
const MAX_PORTABLE_COMPONENT_BYTES = 255;

export function isPortablePathComponent(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && value !== '/'
    && value !== '\\'
    && !value.includes('/')
    && !value.includes('\\')
    && !WINDOWS_INVALID_CHARACTER.test(value)
    && !containsControlCharacter(value)
    && !WINDOWS_RESERVED_NAME.test(value)
    && !/[. ]$/u.test(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_PORTABLE_COMPONENT_BYTES;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) <= 0x1f) return true;
  }
  return false;
}

/** Comparison key shared by backup admission and manifest validation. */
export function portablePathComparisonKey(value: string): string {
  return value
    .split('/')
    .map((component) => component.normalize('NFC').toLowerCase())
    .join('/');
}
