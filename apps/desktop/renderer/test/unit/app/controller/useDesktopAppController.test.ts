import { describe, expect, it } from 'vitest';
import {
  createChatCapabilitySelectionRequest,
} from '../../../../src/app/controller/useDesktopAppController.js';

describe('createChatCapabilitySelectionRequest', () => {
  it('targets the next active main composer without an ephemeral composer identity', () => {
    expect(createChatCapabilitySelectionRequest({ kind: 'skill', id: 'skill-creator' }, 3)).toEqual({
      kind: 'skill',
      id: 'skill-creator',
      requestId: 3,
    });
  });
});
