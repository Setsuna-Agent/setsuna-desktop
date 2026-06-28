import { describe, expect, it } from 'vitest';
import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { toolRunGroupDefaultOpen, toolRunPanelDefaultOpen } from './RuntimeToolRuns.js';

describe('RuntimeToolRuns default expansion', () => {
  it('opens live shell output while keeping completed successful shell runs collapsed', () => {
    expect(toolRunPanelDefaultOpen(shellRun('running'))).toBe(true);
    expect(toolRunPanelDefaultOpen(shellRun('success'))).toBe(false);
  });

  it('opens failed shell and generic tool details', () => {
    expect(toolRunPanelDefaultOpen(shellRun('error'))).toBe(true);
    expect(toolRunPanelDefaultOpen({ id: 'call_generic', name: 'some_tool', status: 'error' })).toBe(true);
  });

  it('opens active or failed groups regardless of tool kind', () => {
    expect(toolRunGroupDefaultOpen('shell', 'running', false)).toBe(true);
    expect(toolRunGroupDefaultOpen('shell', 'success', false)).toBe(false);
    expect(toolRunGroupDefaultOpen('inspection', 'error', false)).toBe(true);
    expect(toolRunGroupDefaultOpen('generic', 'success', true)).toBe(true);
  });
});

function shellRun(status: RuntimeToolRun['status']): RuntimeToolRun {
  return {
    id: `call_${status}`,
    name: 'run_shell_command',
    status,
    argumentsPreview: '{"command":"pnpm test"}',
    resultPreview: status === 'running' ? 'stdout: running\n' : '$ pnpm test\nexit: 0',
  };
}
