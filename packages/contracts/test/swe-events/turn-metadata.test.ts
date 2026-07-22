import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import {
  createSweNotificationMapper
} from '../../src/swe-events.js';
import {
  fileCompletedEvent
} from '../support/swe-events.js';

describe('runtime AppServer SWE turn metadata and diffs', () => {
  it('maps model safety, verification, token count, and explicit turn diff notifications', () => {
      const mapEvent = createSweNotificationMapper();
      const stepSnapshot = {
        threadId: 'thread_1',
        turnId: 'turn_1',
        threadLastSeq: 3,
        conversationMessageIds: ['msg_user'],
        messageIds: ['msg_system', 'msg_user'],
        toolNames: ['read_file'],
        toolRuntimes: [{
          name: 'read_file',
          source: 'host' as const,
          exposure: 'direct' as const,
          supportsParallel: true,
          waitsForRuntimeCancellation: true,
        }],
        toolChoice: 'auto' as const,
        toolEnvironment: {
          id: 'project_1',
          cwd: '/tmp/project',
          workspaceRoot: '/tmp/project',
          workspaceRoots: ['/tmp/project'],
          repository: { kind: 'git' as const, root: '/tmp', workspacePrefix: 'project' },
        },
        selectedSkills: [],
        mcpServerKeys: ['filesystem'],
        mcpServerCount: 1,
        permissionProfile: 'workspace-write' as const,
        featureKeys: ['request_permissions_tool'],
        worldState: {
          activeProviderId: 'test',
          memoryEnabled: true,
          threadMessageCount: 1,
          threadUpdatedAt: '2026-06-27T00:00:00.000Z',
        },
      };
      const snapshot: RuntimeEvent = {
        id: 'event_snapshot_1',
        seq: 0,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.step_snapshot',
        createdAt: '2026-06-27T00:00:00.500Z',
        payload: { snapshot: stepSnapshot },
      };
      const safety: RuntimeEvent = {
        id: 'event_safety_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'safety.buffering',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          buffering: {
            model: 'current-model',
            fasterModel: 'faster-model',
            reasons: ['user_risk'],
            showBufferingUi: true,
            useCases: ['cyber'],
          },
        },
      };
      const verification: RuntimeEvent = {
        id: 'event_verification_1',
        seq: 2,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'model.verification',
        createdAt: '2026-06-27T00:00:02.000Z',
        payload: { verification: { model: 'current-model', provider: 'setsuna', warnings: ['fallback'] } },
      };
      const tokenCount: RuntimeEvent = {
        id: 'event_tokens_1',
        seq: 3,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'token.count',
        createdAt: '2026-06-27T00:00:03.000Z',
        payload: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, modelContextWindow: 128000 },
      };
      const reasoningSummaryPart: RuntimeEvent = {
        id: 'event_reasoning_summary_part_1',
        seq: 4,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'reasoning.summary_part_added',
        createdAt: '2026-06-27T00:00:03.500Z',
        payload: { itemId: 'reasoning_1', summaryIndex: 2 },
      };
      const diff: RuntimeEvent = {
        id: 'event_diff_1',
        seq: 5,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-27T00:00:04.000Z',
        payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
      };
  
      const mappedSnapshot = mapEvent(snapshot);
      expect(mappedSnapshot).toEqual([{
        method: 'turn/stepSnapshot/updated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          stepSnapshot: {
            createdAtMs: 1782518400500,
            snapshot: stepSnapshot,
          },
        },
      }]);
      const mappedStepSnapshot = mappedSnapshot[0];
      if (mappedStepSnapshot?.method !== 'turn/stepSnapshot/updated') throw new Error('expected a step snapshot notification');
      mappedStepSnapshot.params.stepSnapshot.snapshot.toolRuntimes![0]!.name = 'mutated';
      mappedStepSnapshot.params.stepSnapshot.snapshot.toolEnvironment!.workspaceRoots!.push('/mutated');
      mappedStepSnapshot.params.stepSnapshot.snapshot.toolEnvironment!.repository!.workspacePrefix = 'mutated';
      expect(stepSnapshot.toolRuntimes[0]!.name).toBe('read_file');
      expect(stepSnapshot.toolEnvironment.workspaceRoots).toEqual(['/tmp/project']);
      expect(stepSnapshot.toolEnvironment.repository.workspacePrefix).toBe('project');
      expect(mapEvent(safety)).toEqual([{
        method: 'model/safetyBuffering/updated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          model: 'current-model',
          useCases: ['cyber'],
          reasons: ['user_risk'],
          showBufferingUi: true,
          fasterModel: 'faster-model',
        },
      }]);
      expect(mapEvent(verification)).toEqual([{
        method: 'model/verification',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          verifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
        },
      }]);
      expect(mapEvent(reasoningSummaryPart)).toEqual([
        {
          method: 'item/started',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            item: { type: 'reasoning', id: 'reasoning_1', summary: [], content: [] },
            startedAtMs: 1782518403500,
          },
        },
        {
          method: 'item/reasoning/summaryPartAdded',
          params: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            itemId: 'reasoning_1',
            summaryIndex: 2,
          },
        },
      ]);
      expect(mapEvent(tokenCount)).toEqual([{
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          tokenUsage: {
            total: {
              totalTokens: 15,
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
              reasoningOutputTokens: 0,
            },
            last: {
              totalTokens: 15,
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: 128000,
          },
        },
      }]);
      expect(mapEvent(diff)).toEqual([{
        method: 'turn/diff/updated',
        params: { threadId: 'thread_1', turnId: 'turn_1', diff: 'diff --git a/a.txt b/a.txt' },
      }]);
    });
  
  it('aggregates turn diff updates across a AppServer SWE mapper stream', () => {
      const mapEvent = createSweNotificationMapper();
      const first = fileCompletedEvent(1, 'one.txt', 'one');
      const second = fileCompletedEvent(2, 'two.txt', 'two');
      const duplicateExplicitDiff: RuntimeEvent = {
        id: 'event_duplicate_diff',
        seq: 3,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-27T00:00:03.000Z',
        payload: { unifiedDiff: 'diff --git a/one.txt b/one.txt\n--- /dev/null\n+++ b/one.txt\n+one' },
      };
  
      const firstDiff = mapEvent(first).find((item) => item.method === 'turn/diff/updated');
      const secondDiff = mapEvent(second).find((item) => item.method === 'turn/diff/updated');
      const duplicateDiff = mapEvent(duplicateExplicitDiff).find((item) => item.method === 'turn/diff/updated');
  
      expect(firstDiff).toMatchObject({
        params: { diff: expect.stringContaining('one.txt') },
      });
      expect(secondDiff).toMatchObject({
        params: {
          diff: expect.stringContaining('one.txt'),
        },
      });
      expect(secondDiff).toMatchObject({
        params: {
          diff: expect.stringContaining('two.txt'),
        },
      });
      const duplicateText = duplicateDiff?.params && 'diff' in duplicateDiff.params ? duplicateDiff.params.diff : '';
      expect(duplicateText.match(/diff --git a\/one\.txt b\/one\.txt/g)).toHaveLength(1);
    });
});
