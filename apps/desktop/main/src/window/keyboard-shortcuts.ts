import type { Input, WebContents } from 'electron';

export function registerWindowKeyboardShortcuts(contents: WebContents) {
  let activeBindings = new Set<string>();
  let recording = false;
  const handleInput = (_event: Electron.Event, input: Input) => {
    const binding = [
      input.control ? 'Control' : null,
      input.alt ? 'Alt' : null,
      input.shift ? 'Shift' : null,
      input.meta ? 'Meta' : null,
      input.code,
    ].filter(Boolean).join('+');
    // Let the renderer handle registered shortcuts (notably Cmd+W) before the
    // native menu can close the window. Leave DOM input and modal guards intact.
    contents.setIgnoreMenuShortcuts(recording || activeBindings.has(binding));
  };
  contents.on('before-input-event', handleInput);
  contents.once('destroyed', () => contents.off('before-input-event', handleInput));

  return {
    setActiveBindings(bindings: readonly string[]) {
      activeBindings = new Set(bindings);
    },
    setRecording(value: boolean) {
      recording = value;
      contents.setIgnoreMenuShortcuts(recording);
    },
  };
}
