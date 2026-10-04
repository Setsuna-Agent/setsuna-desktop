/** Plain text is assigned through DOM properties, never interpolated into markup. */
export function sandboxPromptPage(input: {
  title: string; message: string; defaultValue: string; confirm: string; cancel: string; replyPrefix: string; dark: boolean;
}): string {
  const config = JSON.stringify(input).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<style>
:root { color-scheme: ${input.dark ? 'dark' : 'light'}; font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
* { box-sizing: border-box; } body { margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
form { display: grid; gap: 16px; } label { line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 100px; overflow: auto; }
input { width: 100%; padding: 9px 10px; font: inherit; color: inherit; background: Field; border: 1px solid GrayText; border-radius: 6px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; } button { min-width: 72px; padding: 7px 16px; border: 1px solid GrayText; border-radius: 6px; font: inherit; cursor: pointer; }
button[type=submit] { background: Highlight; color: HighlightText; border-color: Highlight; }
</style></head><body><form><label for="value"></label><input id="value" autocomplete="off"><div class="actions"><button type="button"></button><button type="submit"></button></div></form>
<script>
const config = ${config};
document.title = config.title;
const input = document.querySelector('input');
input.value = config.defaultValue;
document.querySelector('label').textContent = config.message;
const cancel = document.querySelector('button[type=button]');
cancel.textContent = config.cancel;
document.querySelector('button[type=submit]').textContent = config.confirm;
let finished = false;
const reply = (value) => { if (!finished) { finished = true; document.title = config.replyPrefix + encodeURIComponent(JSON.stringify(value)); } };
cancel.addEventListener('click', () => reply(null));
document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); reply(input.value); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); reply(null); } });
input.focus(); input.select();
</script></body></html>`;
}
