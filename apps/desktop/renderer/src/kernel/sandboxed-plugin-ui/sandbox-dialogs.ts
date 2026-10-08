import { SANDBOX_DIALOG_PATH, SANDBOX_DIALOG_THEME_VARIABLES } from '@setsuna-desktop/contracts';

export function sandboxDialogEndpoint(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.search || url.hash || !url.pathname.startsWith(SANDBOX_DIALOG_PATH)
    || !/^[a-f0-9]{64}$/u.test(url.pathname.slice(SANDBOX_DIALOG_PATH.length))) {
    throw new Error('Invalid sandbox dialog endpoint.');
  }
  return url.href;
}

/** Native-compatible synchronous return values are essential for existing `if (confirm(...))` callers. */
export function sandboxDialogBootstrap(endpoint?: string): string {
  return `(() => {
    const endpoint = ${JSON.stringify(sandboxDialogEndpoint(endpoint) ?? null)};
    const Request = window.XMLHttpRequest;
    const themeVariables = ${JSON.stringify(SANDBOX_DIALOG_THEME_VARIABLES)};
    const request = (kind, message, defaultValue) => {
      if (!endpoint) throw new Error('Desktop dialogs are unavailable. Reopen this application in Setsuna Desktop.');
      // Capture the already-projected host theme before synchronous XHR blocks this renderer.
      const styles = window.getComputedStyle(window.document.documentElement);
      const variables = Object.fromEntries(themeVariables.map(name => [name, styles.getPropertyValue(name).trim()]).filter(([, value]) => value));
      const theme = { colorScheme: styles.colorScheme === 'dark' ? 'dark' : 'light', variables };
      const xhr = new Request();
      // The response waits in the main process; its dialog uses a separate native
      // window/renderer so the caller can retain ordinary synchronous JS semantics.
      xhr.open('POST', endpoint, false);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.send(JSON.stringify({ kind, message: String(message), theme, ...(kind === 'prompt' ? { defaultValue: String(defaultValue) } : {}) }));
      const response = JSON.parse(xhr.responseText);
      if (xhr.status !== 200) throw new Error(response.error || 'Desktop dialog failed.');
      const value = response.value;
      if (kind === 'confirm' && typeof value !== 'boolean') throw new Error('Invalid confirmation result.');
      if (kind === 'prompt' && value !== null && typeof value !== 'string') throw new Error('Invalid prompt result.');
      return value;
    };
    window.alert = (message = '') => { request('alert', message); };
    window.confirm = (message = '') => request('confirm', message);
    window.prompt = (message = '', defaultValue = '') => request('prompt', message, defaultValue);
  })();`;
}
