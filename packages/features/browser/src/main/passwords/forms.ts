export type PasswordForm = {
  password: HTMLInputElement;
  username: HTMLInputElement | null;
  scope: ParentNode;
};

/** Serialized into the isolated world; keep this function free of module state. */
export function findPasswordForms(): PasswordForm[] {
  const visible = (input: HTMLInputElement) => !input.disabled && !input.readOnly
    && !input.closest('[hidden], [inert]') && input.getClientRects().length > 0
    && getComputedStyle(input).visibility !== 'hidden';
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).slice(0, 200);
  const results: PasswordForm[] = [];
  for (const password of inputs.filter((input) => input.type === 'password' && visible(input))) {
    const scope = password.form ?? document;
    const scopedInputs = inputs.filter((input) => password.form ? input.form === password.form : !input.form);
    const fields = scopedInputs.filter(visible);
    // Login widgets can include hidden dummy password fields to suppress autofill.
    // Count usable fields, while respecting explicit registration/change-password hints.
    const passwordFields = fields.filter((input) => input.type === 'password');
    if (passwordFields.length !== 1 || scopedInputs.some((input) => input.autocomplete.split(/\s+/).includes('new-password'))) continue;
    if (password.form && new URL(password.form.action || location.href, location.href).origin !== location.origin) continue;
    const candidates = fields.filter((input) => ['text', 'email', 'tel'].includes(input.type)
      && !input.autocomplete.includes('one-time-code')
      && !/otp|one.?time|verification|captcha/i.test(`${input.name} ${input.id}`));
    const username = candidates.find((input) => input.autocomplete.split(/\s+/).includes('username'))
      ?? candidates.find((input) => /user|email|login|account|identifier/i.test(`${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''}`))
      ?? candidates.filter((input) => Boolean(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)
      ?? null;
    results.push({ password, username, scope });
  }
  return results;
}
