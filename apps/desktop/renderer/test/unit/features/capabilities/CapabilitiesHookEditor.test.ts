import { describe, expect, it } from 'vitest';
import {
  hookDraftFromMetadata,
  hookDraftToInput,
} from '../../../../src/features/capabilities/CapabilitiesHookEditor.js';

describe('capabilities hook editor model', () => {
  it('maps runtime hook metadata back to editable config event names', () => {
    expect(hookDraftFromMetadata({
      key: 'pre-tool',
      eventName: 'preToolUse',
      handlerType: 'command',
      matcher: 'Bash',
      command: './guard.sh',
      timeoutSec: 20,
      statusMessage: 'Checking',
      sourcePath: '/repo/.claude/settings.json',
      source: 'project',
      pluginId: null,
      displayOrder: 0,
      enabled: true,
      isManaged: false,
      currentHash: 'hash',
      trustStatus: 'trusted',
    })).toMatchObject({
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: './guard.sh',
      timeoutSec: '20',
    });
  });

  it('trims persisted fields and omits matchers for matcher-free events', () => {
    expect(hookDraftToInput({
      eventName: 'Stop',
      matcher: ' ignored ',
      command: '  ./notify.sh  ',
      commandWindows: ' powershell notify.ps1 ',
      timeoutSec: '15',
      statusMessage: ' Done ',
    })).toEqual({
      eventName: 'Stop',
      command: './notify.sh',
      commandWindows: 'powershell notify.ps1',
      timeoutSec: 15,
      statusMessage: 'Done',
    });
  });
});
