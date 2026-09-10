// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { afterEach, expect, it } from 'vitest';

const css = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const controls = css('packages/renderer-ui/src/styles/controls.css');
const hostStyles = [
  'apps/desktop/renderer/src/shared/styles/primitives.css',
  'apps/desktop/renderer/src/app/styles/sidebar.css',
  'apps/desktop/renderer/src/features/chat/styles/chat-assistant.css',
  'packages/features/model-provider/src/renderer/model-provider.css',
].map(css).join('\n');
let stylesheet: HTMLStyleElement;

afterEach(() => {
  cleanup();
  stylesheet?.remove();
});

// Feature CSS may be evaluated before the host's main stylesheet in Vite.
it.each(['before', 'after'] as const)('preserves host row/grid alignment when shared controls load %s feature CSS', (order) => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = order === 'before' ? `${controls}\n${hostStyles}` : `${hostStyles}\n${controls}`;
  document.head.append(stylesheet);
  render(<>
    <Button variant="ghost" className="chat-work-history__summary">Work history</Button>
    <Button variant="ghost" className="desktop-agent-thread-list__show-more">More threads</Button>
    <Button variant="ghost" className="sd-page-back sd-page-back--block">Back</Button>
    <Button variant="ghost" className="model-provider-settings__rail-item">
      <span>Icon</span><span>Provider</span>
    </Button>
    <div className="desktop-agent-floating-menu">
      <Button variant="ghost" role="menuitem">Edit</Button>
      <Button variant="danger" role="menuitem">Remove</Button>
    </div>
    <Button variant="primary">Save</Button>
    <Button>Cancel</Button>
    <IconButton label="Close"><span>×</span></IconButton>
    <Button variant="ghost" className="desktop-agent-project__action">Project action</Button>
  </>);
  const style = (name: string, role = 'button') => getComputedStyle(screen.getByRole(role, { name }));

  for (const name of ['Work history', 'More threads']) {
    expect(style(name).justifyContent).toBe('normal');
    expect(style(name).textAlign).toBe('left');
  }
  expect(style('Back').justifyContent).toBe('flex-start');
  const provider = style('Icon Provider');
  expect(provider.display).toBe('grid');
  expect(provider.gridTemplateColumns).toBe('32px minmax(0, 1fr)');
  expect(provider.minHeight).toBe('60px');
  expect(provider.padding).toBe('9px 10px');
  expect(provider.textAlign).toBe('left');
  for (const name of ['Edit', 'Remove']) {
    expect(style(name, 'menuitem').justifyContent).toBe('normal');
  }
  for (const name of ['Save', 'Cancel', 'Close', 'Project action']) {
    expect(style(name).justifyContent).toBe('center');
  }
});
