// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatStarter } from '../../../../../src/features/chat/conversation/ChatStarter.js';

afterEach(cleanup);

describe('ChatStarter', () => {
  it('keeps the host composer outside replaceable starter content', () => {
    render(
      <ChatStarter composer={<div>host composer</div>}>
        <div>replacement conversation</div>
      </ChatStarter>,
    );

    expect(screen.getByText('replacement conversation')).toBeTruthy();
    expect(screen.getByText('host composer')).toBeTruthy();
  });
});
