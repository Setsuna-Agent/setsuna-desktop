import { describe, expect, it } from 'vitest';
import type { RuntimeConfigState, RuntimeHookMetadata } from '@setsuna-desktop/contracts';
import { deleteHookFromConfig, hookConfigLocation, updateHookInConfig } from './runtimeHookConfig.js';

describe('runtimeHookConfig', () => {
  it('parses hook locations without losing Windows drive prefixes', () => {
    const location = hookConfigLocation(hookMetadata({
      key: 'C:\\Users\\zy\\.setsuna\\config.json:pre_tool_use:2:3',
    }));

    expect(location).toMatchObject({
      sourcePath: 'C:\\Users\\zy\\.setsuna\\config.json',
      eventName: 'PreToolUse',
      eventKeyLabel: 'pre_tool_use',
      groupIndex: 2,
      handlerIndex: 3,
    });
  });

  it('updates a hook in place and lets the trust hash become modified naturally', () => {
    const hooks = baseHooksConfig();
    const location = hookConfigLocation(hookMetadata())!;
    const next = updateHookInConfig(hooks, location, {
      eventName: 'PreToolUse',
      matcher: 'run_shell_command',
      command: 'node updated.js',
      timeoutSec: 20,
      statusMessage: 'Updated',
    });

    expect(next.PreToolUse?.[0]).toEqual({
      matcher: 'run_shell_command',
      hooks: [{
        type: 'command',
        command: 'node updated.js',
        commandWindows: 'node original-win.js',
        timeoutSec: 20,
        statusMessage: 'Updated',
      }],
    });
    expect(next.state?.['/config.json:pre_tool_use:0:0']).toEqual({ enabled: true, trustedHash: 'old-hash' });
  });

  it('deletes a hook and clears same-event trust state to avoid stale index trust', () => {
    const hooks = baseHooksConfig();
    const location = hookConfigLocation(hookMetadata())!;
    const next = deleteHookFromConfig(hooks, location);

    expect(next.PreToolUse).toBeUndefined();
    expect(next.PostToolUse).toHaveLength(1);
    expect(next.state).toEqual({
      '/config.json:post_tool_use:0:0': { enabled: true, trustedHash: 'post-hash' },
    });
  });
});

function baseHooksConfig(): NonNullable<RuntimeConfigState['hooks']> {
  return {
    PreToolUse: [{
      matcher: 'run_shell_command',
      hooks: [{
        type: 'command',
        command: 'node original.js',
        commandWindows: 'node original-win.js',
        timeoutSec: 10,
        statusMessage: 'Original',
      }],
    }],
    PostToolUse: [{
      matcher: 'apply_patch',
      hooks: [{
        type: 'command',
        command: 'node post.js',
      }],
    }],
    state: {
      '/config.json:pre_tool_use:0:0': { enabled: true, trustedHash: 'old-hash' },
      '/config.json:pre_tool_use:1:0': { enabled: true, trustedHash: 'shifted-hash' },
      '/config.json:post_tool_use:0:0': { enabled: true, trustedHash: 'post-hash' },
    },
  };
}

function hookMetadata(patch: Partial<RuntimeHookMetadata> = {}): RuntimeHookMetadata {
  return {
    key: '/config.json:pre_tool_use:0:0',
    eventName: 'preToolUse',
    handlerType: 'command',
    matcher: 'run_shell_command',
    command: 'node original.js',
    timeoutSec: 10,
    statusMessage: 'Original',
    sourcePath: '/config.json',
    source: 'user',
    pluginId: null,
    displayOrder: 0,
    enabled: true,
    isManaged: false,
    currentHash: 'current-hash',
    trustStatus: 'trusted',
    ...patch,
  };
}
