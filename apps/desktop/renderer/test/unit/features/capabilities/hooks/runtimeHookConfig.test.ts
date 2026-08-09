import type { RuntimeHookMetadata } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  deleteHookFromConfig,
  hookConfigLocation,
} from '../../../../../src/features/capabilities/hooks/runtimeHookConfig.js';

describe('runtime hook config helpers', () => {
  it('parses Windows source paths and deletes the selected standalone Hook state', () => {
    const hook = {
      key: 'C:\\runtime\\config.json:pre_tool_use:0:0',
      eventName: 'preToolUse',
      handlerType: 'command',
      matcher: 'shell',
      command: 'echo checked',
      timeoutSec: 30,
      statusMessage: null,
      sourcePath: 'C:\\runtime\\config.json',
      source: 'user',
      pluginId: null,
      displayOrder: 0,
      enabled: true,
      isManaged: false,
      currentHash: 'hash',
      trustStatus: 'trusted',
    } satisfies RuntimeHookMetadata;
    const location = hookConfigLocation(hook);

    expect(location).toEqual({
      eventName: 'PreToolUse',
      eventKeyLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      sourcePath: hook.sourcePath,
    });
    expect(deleteHookFromConfig({
      PreToolUse: [{ matcher: 'shell', hooks: [{ type: 'command', command: 'echo checked' }] }],
      state: { [hook.key]: { enabled: true, trustedHash: 'hash' } },
    }, location!)).toEqual({});
  });

  it('preserves and rekeys sibling Hook state after deletion', () => {
    const location = {
      eventName: 'PreToolUse',
      eventKeyLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      sourcePath: 'C:\\runtime\\config.json',
    } as const;
    const prefix = `${location.sourcePath}:${location.eventKeyLabel}:`;

    expect(deleteHookFromConfig({
      PreToolUse: [
        {
          matcher: 'shell',
          hooks: [
            { type: 'command', command: 'echo removed' },
            { type: 'command', command: 'echo retained' },
          ],
        },
        { matcher: 'read_file', hooks: [{ type: 'command', command: 'echo later group' }] },
      ],
      state: {
        [`${prefix}0:0`]: { trustedHash: 'removed' },
        [`${prefix}0:1`]: { enabled: false, trustedHash: 'retained' },
        [`${prefix}1:0`]: { trustedHash: 'later' },
      },
    }, location)).toEqual({
      PreToolUse: [
        { matcher: 'shell', hooks: [{ type: 'command', command: 'echo retained' }] },
        { matcher: 'read_file', hooks: [{ type: 'command', command: 'echo later group' }] },
      ],
      state: {
        [`${prefix}0:0`]: { enabled: false, trustedHash: 'retained' },
        [`${prefix}1:0`]: { trustedHash: 'later' },
      },
    });
  });

  it('rekeys later Hook groups even when their source paths differ', () => {
    const location = {
      eventName: 'PreToolUse',
      eventKeyLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      sourcePath: 'C:\\runtime\\config.json',
    } as const;
    const pluginSourcePath = 'C:\\runtime\\plugins\\audit\\.setsuna-plugin\\plugin.json';

    expect(deleteHookFromConfig({
      PreToolUse: [
        { matcher: 'shell', hooks: [{ type: 'command', command: 'echo removed' }] },
        {
          matcher: 'read_file',
          hooks: [{
            type: 'command',
            command: 'echo plugin',
            sourcePath: pluginSourcePath,
            pluginId: 'audit',
          }],
        },
      ],
      state: {
        [`${location.sourcePath}:pre_tool_use:0:0`]: { trustedHash: 'removed' },
        [`${pluginSourcePath}:pre_tool_use:1:0`]: { enabled: false, trustedHash: 'plugin' },
      },
    }, location)).toEqual({
      PreToolUse: [{
        matcher: 'read_file',
        hooks: [{
          type: 'command',
          command: 'echo plugin',
          sourcePath: pluginSourcePath,
          pluginId: 'audit',
        }],
      }],
      state: {
        [`${pluginSourcePath}:pre_tool_use:0:0`]: { enabled: false, trustedHash: 'plugin' },
      },
    });
  });
});
