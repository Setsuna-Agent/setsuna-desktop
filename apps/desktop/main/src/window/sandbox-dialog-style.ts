/** Dialogs run in an isolated renderer, so their surface uses the sandbox's host theme tokens. */
export const sandboxDialogStyle = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  color: var(--setsuna-color-text, CanvasText);
  background: var(--setsuna-color-surface, Canvas);
  font: 13px/20px var(--setsuna-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
}
form { display: grid; gap: 16px; margin: 0; padding: 24px; outline: none; }
label {
  max-height: 144px;
  overflow: auto;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
input {
  appearance: none;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--setsuna-color-border, GrayText);
  border-radius: var(--setsuna-radius-field, 8px);
  outline: none;
  color: inherit;
  background: var(--setsuna-color-surface, Canvas);
  font: inherit;
  transition: border-color 150ms ease;
}
input:hover:not(:focus) { border-color: var(--setsuna-color-border-strong, GrayText); }
input::selection {
  color: var(--setsuna-color-accent-text, HighlightText);
  background: var(--setsuna-color-accent, Highlight);
}
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  min-height: 32px;
  padding: 5px 16px;
  border: 1px solid var(--setsuna-color-border, GrayText);
  border-radius: var(--setsuna-radius-control, 999px);
  color: inherit;
  background: var(--setsuna-color-surface, Canvas);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
button:hover {
  background: var(--setsuna-color-surface-muted, ButtonFace);
  border-color: var(--setsuna-color-border-strong, GrayText);
}
button:focus-visible { outline: 2px solid var(--setsuna-color-accent, Highlight); outline-offset: 2px; }
button[type=submit] {
  color: var(--setsuna-color-accent-text, Canvas);
  background: var(--setsuna-color-accent, CanvasText);
  border-color: transparent;
}
button[type=submit]:hover {
  background: var(--setsuna-color-accent-hover, CanvasText);
  border-color: transparent;
}
input[hidden], button[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { input, button { transition: none; } }
`;
