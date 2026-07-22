import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import type { SweNotification } from '../../src/swe-events.js';
import {
  createSweNotificationMapper,
  filterSweNotificationsForClientCapabilities,
  runtimeEventToSweNotifications
} from '../../src/swe-events.js';
import {
  toolStartedFilePreview
} from '../support/swe-events.js';

describe('runtime AppServer SWE approvals and file changes', () => {
  it('maps file mutation tool events to AppServer fileChange item lifecycle notifications', () => {
      const preview = JSON.stringify({
        diff: {
          path: 'src/generated.txt',
          action: 'Created',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', content: 'generated', newLine: 1 }],
        },
      });
      const started: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'tool.started',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          toolCallId: 'call_1',
          toolName: 'write_file',
          argumentsPreview: '{"file_path":"src/generated.txt"}',
          resultPreview: preview,
        },
      };
      const completed: RuntimeEvent = {
        id: 'event_2',
        seq: 2,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'tool.completed',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          toolCallId: 'call_1',
          toolName: 'write_file',
          status: 'success',
          content: preview,
        },
      };
  
      expect(runtimeEventToSweNotifications(started)).toEqual([
        {
          method: 'item/started',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
            item: {
              type: 'fileChange',
              id: 'call_1',
              status: 'inProgress',
              changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
            },
          },
        },
        {
          method: 'item/fileChange/patchUpdated',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            itemId: 'call_1',
            changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
          },
        },
      ]);
      expect(runtimeEventToSweNotifications(completed)).toEqual([
        {
          method: 'item/completed',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
            item: {
              type: 'fileChange',
              id: 'call_1',
              status: 'completed',
              changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
            },
          },
        },
        {
          method: 'turn/diff/updated',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            diff: 'diff --git a/src/generated.txt b/src/generated.txt\n--- /dev/null\n+++ b/src/generated.txt\n+generated',
          },
        },
      ]);
    });
  
  it('maps file mutation approvals to AppServer fileChange approval requests', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'apply_patch',
            reason: 'Review file change before applying apply_patch to src/generated.txt.',
            argumentsPreview: JSON.stringify({
              diff: {
                path: 'src/generated.txt',
                action: 'Created',
                lines: [{ type: 'added', content: 'generated' }],
              },
            }),
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([
        {
          method: 'item/fileChange/patchUpdated',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            itemId: 'call_1',
            changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
          },
        },
        {
          method: 'item/fileChange/requestApproval',
          id: 'approval_1',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            itemId: 'call_1',
            startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
            reason: 'Review file change before applying apply_patch to src/generated.txt.',
            grantRoot: null,
          },
        },
      ]);
    });
  
  it('streams file patch updates without repeating item started for the same call', () => {
      const mapEvent = createSweNotificationMapper();
      const first = toolStartedFilePreview(1, 'call_1', 'src/generated.txt', 'one');
      const second = toolStartedFilePreview(2, 'call_1', 'src/generated.txt', 'two');
  
      expect(mapEvent(first).map((item) => item.method)).toEqual([
        'item/started',
        'item/fileChange/patchUpdated',
      ]);
      expect(mapEvent(second)).toEqual([{
        method: 'item/fileChange/patchUpdated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+two' }],
        },
      }]);
    });
  
  it('maps request_permissions approvals to AppServer permission approval requests', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_permissions',
            toolName: 'request_permissions',
            reason: 'Additional permissions requested: network access; writable roots: /work/tmp.',
            argumentsPreview: '{}',
            permissionApprovalContext: {
              environmentId: 'project_1',
              cwd: '/work',
              reason: 'Need network and temp write access.',
              requestedPermissions: {
                network: { enabled: true },
                file_system: {
                  read: ['/work/readonly'],
                  write: ['/work/tmp'],
                  glob_scan_max_depth: 4,
                  entries: [
                    { path: { type: 'glob_pattern', pattern: '**/*.env' }, access: 'deny' },
                    { path: { type: 'special', value: { kind: 'project_roots', subpath: 'tmp' } }, access: 'write' },
                  ],
                },
              },
              grantedPermissions: {},
              availableScopes: ['turn', 'session'],
            },
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/permissions/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_permissions',
          environmentId: 'project_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          cwd: '/work',
          reason: 'Need network and temp write access.',
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: ['/work/readonly'],
              write: ['/work/tmp'],
              globScanMaxDepth: 4,
              entries: [
                { path: { type: 'globPattern', pattern: '**/*.env' }, access: 'deny' },
                { path: { type: 'special', value: { kind: 'project_roots', subpath: 'tmp' } }, access: 'write' },
              ],
            },
          },
        },
      }]);
    });
  
  it('maps shell approvals to AppServer commandExecution approval requests', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'run_shell_command',
            reason: 'High risk command requires approval.',
            argumentsPreview: '{"command":"git reset --hard","directory":"."}',
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/commandExecution/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          approvalId: null,
          environmentId: null,
          reason: 'High risk command requires approval.',
          networkApprovalContext: null,
          command: 'git reset --hard',
          cwd: '.',
          commandActions: [{ type: 'unknown', command: 'git reset --hard' }],
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: null,
        },
      }]);
    });
  
  it('maps Codex policy proposal fields on shell approval requests', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'exec_command',
            reason: 'Network access requires approval.',
            argumentsPreview: '{"cmd":"curl https://api.example.com/health","workdir":"/work"}',
            proposedExecPolicyAmendment: ['curl'],
            networkApprovalContext: {
              host: 'api.example.com',
              protocol: 'https',
              port: 443,
              target: 'https://api.example.com/health',
            },
            proposedNetworkPolicyAmendments: [{ host: 'api.example.com', action: 'allow' }],
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/commandExecution/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          approvalId: null,
          environmentId: null,
          reason: 'Network access requires approval.',
          networkApprovalContext: { host: 'api.example.com', protocol: 'https' },
          command: 'curl https://api.example.com/health',
          cwd: '/work',
          commandActions: [{ type: 'unknown', command: 'curl https://api.example.com/health' }],
          proposedExecpolicyAmendment: ['curl'],
          proposedNetworkPolicyAmendments: [{ host: 'api.example.com', action: 'allow' }],
        },
      }]);
    });
  
  it('maps best-effort shell command actions on command approvals', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'exec_command',
            reason: 'Command requires approval.',
            argumentsPreview: '{"cmd":"rg TODO src && cat README.md","workdir":"/work"}',
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/commandExecution/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          approvalId: null,
          environmentId: null,
          reason: 'Command requires approval.',
          networkApprovalContext: null,
          command: 'rg TODO src && cat README.md',
          cwd: '/work',
          commandActions: [
            { type: 'search', command: 'rg TODO src', query: 'TODO', path: 'src' },
            { type: 'read', command: 'cat README.md', name: 'README.md', path: '/work/README.md' },
          ],
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: null,
        },
      }]);
    });
  
  it('maps Codex available command approval decisions', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'exec_command',
            environmentId: 'project_1',
            reason: 'Command requires approval.',
            argumentsPreview: '{"cmd":"git status","workdir":"/work"}',
            additionalPermissions: {
              network: { enabled: true },
              file_system: {
                read: ['/work/readonly'],
                write: ['/work/tmp'],
                glob_scan_max_depth: 3,
                entries: [{ path: { type: 'glob_pattern', pattern: '/work/**/*.env' }, access: 'deny' }],
              },
            },
            availableDecisions: [
              { type: 'approve' },
              { type: 'approve_for_turn_with_strict_auto_review' },
              { type: 'approve_for_session' },
              { type: 'approve_persistently' },
              { type: 'approve_exec_policy_amendment', proposedExecPolicyAmendment: ['git', 'status'] },
              { type: 'approve_network_policy_amendment', networkPolicyAmendment: { host: 'api.example.com', action: 'deny' } },
              { type: 'reject' },
              { type: 'cancel' },
            ],
            status: 'pending',
            createdAt: '2026-06-27T00:00:00.000Z',
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/commandExecution/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          approvalId: null,
          environmentId: 'project_1',
          reason: 'Command requires approval.',
          networkApprovalContext: null,
          command: 'git status',
          cwd: '/work',
          commandActions: [{ type: 'unknown', command: 'git status' }],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: {
              read: ['/work/readonly'],
              write: ['/work/tmp'],
              globScanMaxDepth: 3,
              entries: [{ path: { type: 'globPattern', pattern: '/work/**/*.env' }, access: 'deny' }],
            },
          },
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: null,
          availableDecisions: [
            'accept',
            'acceptForSession',
            'acceptAndRemember',
            { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } },
            { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'api.example.com', action: 'deny' } } },
            'decline',
            'cancel',
          ],
        },
      }]);
    });
  
  it('strips experimental command approval fields unless the client enabled experimentalApi', () => {
      const notification: SweNotification = {
        method: 'item/commandExecution/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          approvalId: null,
          environmentId: 'project_1',
          reason: 'Need extra access.',
          networkApprovalContext: null,
          command: 'cat README.md',
          cwd: '/work',
          commandActions: [{ type: 'read', command: 'cat README.md', name: 'README.md', path: '/work/README.md' }],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: { read: ['/work/allowed'] },
          },
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: null,
        },
      };
  
      const stripped = filterSweNotificationsForClientCapabilities([notification]);
      const experimental = filterSweNotificationsForClientCapabilities([notification], { experimentalApi: true });
  
      expect(stripped).toEqual([{
        ...notification,
        params: expect.not.objectContaining({
          additionalPermissions: expect.anything(),
        }),
      }]);
      expect(experimental).toEqual([notification]);
      expect(notification.params.additionalPermissions).toEqual({
        network: { enabled: true },
        fileSystem: { read: ['/work/allowed'] },
      });
    });
  
  it('maps resolved approvals to AppServer server request resolved notifications', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.resolved',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          approvalId: 'approval_1',
          decision: 'approve',
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'serverRequest/resolved',
        params: {
          threadId: 'thread_1',
          requestId: 'approval_1',
        },
      }]);
    });
  
  it('emits AppServer thread status changes for turn and approval activity', () => {
      const mapEvent = createSweNotificationMapper();
      const started: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.started',
        createdAt: '2026-06-27T00:00:00.000Z',
        payload: { input: 'run command' },
      };
      const requested: RuntimeEvent = {
        id: 'event_2',
        seq: 2,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.requested',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          approval: {
            id: 'approval_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolCallId: 'call_1',
            toolName: 'run_shell_command',
            reason: 'High risk command requires approval.',
            argumentsPreview: '{"command":"git status","directory":"."}',
            status: 'pending',
            createdAt: '2026-06-27T00:00:01.000Z',
          },
        },
      };
      const resolved: RuntimeEvent = {
        id: 'event_3',
        seq: 3,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'approval.resolved',
        createdAt: '2026-06-27T00:00:02.000Z',
        payload: { approvalId: 'approval_1', decision: 'approve' },
      };
      const completed: RuntimeEvent = {
        id: 'event_4',
        seq: 4,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.completed',
        createdAt: '2026-06-27T00:00:03.000Z',
        payload: {},
      };
  
      expect(mapEvent(started)[0]).toEqual({
        method: 'thread/status/changed',
        params: { threadId: 'thread_1', status: { type: 'active', activeFlags: [] } },
      });
      expect(mapEvent(requested).at(-1)).toEqual({
        method: 'thread/status/changed',
        params: { threadId: 'thread_1', status: { type: 'active', activeFlags: ['waitingOnApproval'] } },
      });
      expect(mapEvent(resolved)).toEqual([
        {
          method: 'serverRequest/resolved',
          params: { threadId: 'thread_1', requestId: 'approval_1' },
        },
        {
          method: 'thread/status/changed',
          params: { threadId: 'thread_1', status: { type: 'active', activeFlags: [] } },
        },
      ]);
      expect(mapEvent(completed).at(-1)).toEqual({
        method: 'thread/status/changed',
        params: { threadId: 'thread_1', status: { type: 'idle' } },
      });
    });
});
