// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, getByRole } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const assetRoot = path.resolve('plugins/app-builder/skills/create-plugin-in-chat/assets');
const source = ['ui-icons.js', 'ui-components.js'].map((file) => readFileSync(path.join(assetRoot, file), 'utf8')).join('\n');

function loadComponents() {
  // Execute the actual resources in a private window namespace, with only DOM access.
  return new Function('window', 'document', `${source}\nreturn window.SetsunaComponents;`)({ document }, document);
}

afterEach(() => document.body.replaceChildren());

it('keeps caller data as text, preserves form values, and routes button clicks without submitting the form', () => {
  const ui = loadComponents();
  const label = '<img src=x onerror="alert(1)">';
  const change = vi.fn();
  const input = ui.field({ label, name: 'name', value: label, onInput: change });
  const select = ui.select({ label: 'Category', name: 'category', options: [{ value: 'a', label }], value: 'a', onChange: change });
  const click = vi.fn();
  const action = ui.button({ label, icon: 'save', onClick: click });
  const form = document.createElement('form');
  const submit = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submit);
  form.append(input.element, select.element, action);
  document.body.append(form);
  expect(form.querySelector('img')).toBeNull();
  expect(new FormData(form).get('name')).toBe(label);
  expect(new FormData(form).get('category')).toBe('a');
  fireEvent.input(input.input, { target: { value: 'Updated' } });
  expect(change).toHaveBeenCalledWith('Updated');
  action.click();
  expect(click).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it('changes tabs by keyboard, skips disabled items, and preserves drafts when returning to a panel', () => {
  const ui = loadComponents();
  const draft = ui.field({ label: 'Draft', name: 'draft', value: 'Unsaved' });
  const change = vi.fn();
  const tabs = ui.tabs({
    label: 'Views',
    items: [
      { id: 'edit', label: 'Edit', content: draft.element },
      { id: 'unavailable', label: 'Unavailable', disabled: true, content: document.createElement('div') },
      { id: 'preview', label: 'Preview', content: document.createElement('div') },
    ],
    onChange: change,
  });
  document.body.append(tabs.element);
  const edit = getByRole(tabs.element, 'tab', { name: 'Edit' });
  const preview = getByRole(tabs.element, 'tab', { name: 'Preview' });
  edit.focus();
  fireEvent.keyDown(edit, { key: 'ArrowRight' });
  expect(tabs.value).toBe('preview');
  expect(change).toHaveBeenLastCalledWith('preview');
  expect(document.activeElement).toBe(preview);
  fireEvent.keyDown(preview, { key: 'ArrowRight' });
  expect(tabs.value).toBe('edit');
  expect(document.activeElement).toBe(edit);
  expect(getByRole(tabs.element, 'textbox', { name: 'Draft' })).toBe(draft.input);
  expect(draft.input.value).toBe('Unsaved');
  fireEvent.keyDown(edit, { key: 'End' });
  fireEvent.keyDown(preview, { key: 'Home' });
  expect(tabs.value).toBe('edit');
  expect(tabs.setValue('unavailable')).toBe(false);
  expect(tabs.setValue('unknown')).toBe(false);
  expect(change).toHaveBeenCalledTimes(4);
});

it('focuses the requested dialog field and restores each opener after close without retaining an old result', () => {
  const ui = loadComponents();
  const field = ui.field({ label: 'Name', name: 'name' });
  const closed = vi.fn();
  const dialog = ui.dialog({ title: 'Edit', content: field.element, closeLabel: 'Close', onClose: closed });
  const first = ui.button({ label: 'First' });
  const second = ui.button({ label: 'Second' });
  document.body.append(first, second);
  first.focus();
  dialog.open(field.input);
  expect(document.activeElement).toBe(field.input);
  dialog.close('saved');
  expect(closed).toHaveBeenLastCalledWith('saved');
  expect(document.activeElement).toBe(first);
  second.focus();
  dialog.open(field.input);
  getByRole(dialog.element, 'button', { name: 'Close' }).click();
  expect(closed).toHaveBeenLastCalledWith('');
  expect(document.activeElement).toBe(second);
  expect(closed).toHaveBeenCalledTimes(2);
  dialog.destroy();
  expect(dialog.element.isConnected).toBe(false);
});
