import { useEffect, useState } from 'react';
import { useKeyboardShortcuts } from '../../shared/shortcuts/KeyboardShortcutsProvider.js';

export function useSidebarNavigationHint(enabled: boolean): boolean {
  const { bindingsFor, recording } = useKeyboardShortcuts();
  const [altHeld, setAltHeld] = useState(false);
  const available = enabled && !recording
    && bindingsFor('navigation.previousChat').includes('Alt+ArrowUp')
    && bindingsFor('navigation.nextChat').includes('Alt+ArrowDown');

  useEffect(() => {
    if (!available) {
      setAltHeld(false);
      return;
    }
    const update = (event: KeyboardEvent) => setAltHeld(
      event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && !event.isComposing && event.key !== 'Process' && !event.getModifierState('AltGraph'),
    );
    const reset = () => setAltHeld(false);
    // Alt+Tab can release Alt in another window, so keyup alone cannot clear the hint reliably.
    window.addEventListener('keydown', update, true);
    window.addEventListener('keyup', update, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', update, true);
      window.removeEventListener('keyup', update, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [available]);

  return available && altHeld;
}
