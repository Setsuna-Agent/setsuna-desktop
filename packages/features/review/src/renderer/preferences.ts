type ReviewPreferenceReader = Pick<Storage, 'getItem'>;
type ReviewPreferenceWriter = Pick<Storage, 'removeItem' | 'setItem'>;

export function readReviewPreference(
  key: string,
  storage: ReviewPreferenceReader | null = browserLocalStorage(),
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeReviewPreference(
  key: string,
  value: string,
  storage: ReviewPreferenceWriter | null = browserLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Preferences must never interrupt review interactions.
  }
}

export function removeReviewPreference(
  key: string,
  storage: ReviewPreferenceWriter | null = browserLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Preferences must never interrupt review interactions.
  }
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
