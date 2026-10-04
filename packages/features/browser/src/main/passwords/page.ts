import type { PasswordForm } from './forms.js';

export type PasswordPageEvent = { kind: 'form'; formId: string } | { kind: 'submit'; username: string; password: string };
export type PasswordPageAction = { kind: 'watch' } | { kind: 'dispose' } | {
  kind: 'fill'; username: string; password: string; formId?: string;
};

declare global {
  interface Window {
    __setsunaPasswords?: { token: string; run(action: PasswordPageAction): unknown };
  }
}

/** Runs only in our isolated world. No page-facing IPC or native methods are installed. */
export function installPasswordPage(token: string, origin: string, findForms: () => PasswordForm[]): void {
  window.__setsunaPasswords?.run({ kind: 'dispose' });
  if (location.origin !== origin) return;
  let nextId = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ((value: PasswordPageEvent | null) => void) | null = null;
  const ids = new WeakMap<HTMLInputElement, string>();
  const capturedAt = new WeakMap<HTMLInputElement, number>();
  const queue: PasswordPageEvent[] = [];
  const emit = (value: PasswordPageEvent) => {
    if (disposed) return;
    if (waiter) { const resolve = waiter; waiter = null; resolve(value); }
    else { if (queue.length === 16) queue.shift(); queue.push(value); }
  };
  const scan = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || location.origin !== origin) return;
    for (const form of findForms()) {
      if (ids.has(form.password)) continue;
      const formId = String(++nextId);
      ids.set(form.password, formId);
      emit({ kind: 'form', formId });
    }
  };
  const observer = new MutationObserver(() => {
    if (!timer) timer = setTimeout(scan, 100);
  });
  const capture = (event: Event) => {
    if (!event.isTrusted || disposed || location.origin !== origin) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.type === 'keydown' && ((event as KeyboardEvent).key !== 'Enter' || (event as KeyboardEvent).isComposing)) return;
    if (event.type === 'click') {
      const button = target.closest('button, input[type="submit"], [role="button"]');
      if (!button) return;
      const submit = (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) && button.type === 'submit';
      if (!submit && !/log.?in|sign.?in|登录|登入/i.test(`${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`)) return;
    }
    const forms = findForms();
    const form = forms.find((item) => item.scope !== document && (item.scope as Element).contains(target))
      ?? (forms.length === 1 && forms[0].scope === document ? forms[0] : null);
    if (event.type === 'keydown' && form?.scope === document && target !== form.username && target !== form.password) return;
    if (!form || !form.password.value || form.password.value.length > 4096
      || (form.username?.value.length ?? 0) > 512 || (form.password.form && !form.password.form.checkValidity())) return;
    const now = Date.now();
    if (now - (capturedAt.get(form.password) ?? 0) < 750) return;
    capturedAt.set(form.password, now);
    emit({ kind: 'submit', username: form.username?.value ?? '', password: form.password.value });
  };
  const setValue = (input: HTMLInputElement, value: string) => {
    // Use the native setter so controlled forms (including React) observe the change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__setsunaPasswords = { token, run(action) {
    if (action.kind === 'dispose') {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      for (const type of ['submit', 'click', 'keydown']) document.removeEventListener(type, capture, true);
      document.removeEventListener('focusin', scan, true);
      queue.length = 0;
      waiter?.(null);
      waiter = null;
      return true;
    }
    if (disposed || location.origin !== origin) return null;
    if (action.kind === 'watch') return queue.length ? queue.shift() : new Promise<PasswordPageEvent | null>((resolve) => { waiter = resolve; });
    const forms = findForms();
    const form = action.formId
      ? forms.find((item) => ids.get(item.password) === action.formId)
      : forms.find((item) => item.password === document.activeElement || item.username === document.activeElement)
        ?? (forms.length === 1 ? forms[0] : null);
    if (!form) return false;
    // Automatic fill must not replace anything the user has already typed.
    if (action.formId && (form.password.value || (form.username?.value && form.username.value !== action.username))) return false;
    if (form.username) setValue(form.username, action.username);
    setValue(form.password, action.password);
    return true;
  } };
  for (const type of ['submit', 'click', 'keydown']) document.addEventListener(type, capture, true);
  document.addEventListener('focusin', scan, true);
  observer.observe(document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['type', 'autocomplete', 'hidden', 'style', 'class', 'disabled', 'readonly'],
  });
  scan();
}
