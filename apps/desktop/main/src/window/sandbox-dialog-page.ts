import type { SandboxDialogRequest, SandboxDialogTheme } from '@setsuna-desktop/contracts';
import { sandboxDialogStyle } from './sandbox-dialog-style.js';

/** Plain text is assigned through DOM properties, never interpolated into markup. */
export function sandboxDialogPage(input: {
  kind: SandboxDialogRequest['kind'];
  title: string; message: string; defaultValue: string; confirm: string; cancel: string; replyPrefix: string; dark: boolean;
  theme?: SandboxDialogTheme;
}): string {
  const config = JSON.stringify(input).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<style>
:root { color-scheme: ${input.dark ? 'dark' : 'light'}; }
${sandboxDialogStyle}
</style></head><body><form role="dialog" aria-modal="true" aria-labelledby="message" tabindex="-1"><label id="message" for="value"></label><input id="value" autocomplete="off"><div class="actions"><button type="button"></button><button type="submit"></button></div></form>
<script>
const config = ${config};
for (const [name, value] of Object.entries(config.theme?.variables ?? {})) {
  document.documentElement.style.setProperty(name, value);
}
document.title = config.title;
const input = document.querySelector('input');
input.hidden = config.kind !== 'prompt';
input.value = config.defaultValue;
document.querySelector('label').textContent = config.message;
const cancel = document.querySelector('button[type=button]');
cancel.hidden = config.kind === 'alert';
cancel.textContent = config.cancel;
document.querySelector('button[type=submit]').textContent = config.confirm;
const form = document.querySelector('form');
let finished = false;
const reply = (value) => { if (!finished) { finished = true; document.title = config.replyPrefix + encodeURIComponent(JSON.stringify(value)); } };
const dismiss = () => reply(config.kind === 'confirm' ? false : null);
cancel.addEventListener('click', dismiss);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  reply(config.kind === 'prompt' ? input.value : config.kind === 'confirm' ? true : null);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
  if (event.key === 'Enter' && !event.isComposing && event.target === form) { event.preventDefault(); form.requestSubmit(); }
});
if (config.kind === 'prompt') { input.focus(); input.select(); } else form.focus();
</script></body></html>`;
}
