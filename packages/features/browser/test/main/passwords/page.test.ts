// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findPasswordForms } from '../../../src/main/passwords/forms.js';
import { installPasswordPage } from '../../../src/main/passwords/page.js';

beforeEach(() => {
  vi.spyOn(HTMLInputElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLInputElement) {
    const hidden = getComputedStyle(this).display === 'none';
    return (hidden ? [] : [{ width: 100, height: 20 }]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  window.__setsunaPasswords?.run({ kind: 'dispose' });
  delete window.__setsunaPasswords;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function form() {
  document.body.innerHTML = '<form><input name="username" autocomplete="username"><input type="password" name="password"><button>Login</button></form>';
  installPasswordPage('document-1', location.origin, findPasswordForms);
  return {
    page: window.__setsunaPasswords!,
    username: document.querySelector<HTMLInputElement>('[name=username]')!,
    password: document.querySelector<HTMLInputElement>('[type=password]')!,
    form: document.querySelector('form')!,
  };
}

it('fills controlled forms, preserves typed values during automatic fill and permits an explicit account choice', async () => {
  const { page, username, password } = form();
  const event = await page.run({ kind: 'watch' }) as { formId: string };
  username.value = 'user-is-typing';
  expect(page.run({ kind: 'fill', formId: event.formId, username: 'alice', password: 'secret' })).toBe(false);
  expect(username.value).toBe('user-is-typing');
  expect(password.value).toBe('');
  const changed = vi.fn();
  password.addEventListener('input', changed);
  expect(page.run({ kind: 'fill', username: 'alice', password: 'secret' })).toBe(true);
  expect(username.value).toBe('alice');
  expect(password.value).toBe('secret');
  expect(changed).toHaveBeenCalledOnce();
});

it('ignores registration and cross-origin submission forms and discovers a dynamically inserted login form', async () => {
  document.body.innerHTML = '<form><input type="password" autocomplete="new-password"><input type="password"></form>';
  expect(findPasswordForms()).toEqual([]);
  document.body.innerHTML = '<form><input type="password"><input type="password"></form>';
  expect(findPasswordForms()).toEqual([]);
  document.body.innerHTML = '<form><input type="password"><input type="password" autocomplete="new-password" hidden></form>';
  expect(findPasswordForms()).toEqual([]);
  document.body.innerHTML = '<form action="https://other.example/submit"><input type="password"></form>';
  expect(findPasswordForms()).toEqual([]);
  document.body.innerHTML = '';
  installPasswordPage('dynamic', location.origin, findPasswordForms);
  const next = window.__setsunaPasswords!.run({ kind: 'watch' });
  document.body.innerHTML = '<form><input name="email"><input type="password"></form>';
  await expect(next).resolves.toMatchObject({ kind: 'form' });
});

it('captures only a submitted login, ignores synthetic events and stops on disposal', async () => {
  const { page, username, password, form: element } = form();
  await page.run({ kind: 'watch' });
  username.value = 'alice';
  password.value = 'entered-secret';
  let captured = false;
  const next = Promise.resolve(page.run({ kind: 'watch' })).then((value) => { captured = true; return value; });
  element.dispatchEvent(new Event('submit', { bubbles: true }));
  await Promise.resolve();
  expect(captured).toBe(false);
  const trusted = new Event('submit', { bubbles: true });
  Object.defineProperty(trusted, 'isTrusted', { value: true });
  element.dispatchEvent(trusted);
  await expect(next).resolves.toEqual({ kind: 'submit', username: 'alice', password: 'entered-secret' });
  const waiting = page.run({ kind: 'watch' });
  page.run({ kind: 'dispose' });
  await expect(waiting).resolves.toBeNull();
  expect(page.run({ kind: 'fill', username: 'different', password: 'different' })).toBeNull();
  expect(password.value).toBe('entered-secret');
});
