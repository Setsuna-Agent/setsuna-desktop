import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { isRecord, recordFromJson, stringField } from './runtimeToolRunPresentationUtils.js';
import { isShellCommandRun, isShellOutputRead, type TranscriptToolRun } from './runtimeToolRunVisibility.js';
import { normalizeShellResultPreview, shellContentLine, shellMetadataLine } from './RuntimeShellToolRun.js';

/** Fold incremental process observations into their command without changing persisted tool records. */
export function projectShellProcessOutputs(messages: RuntimeMessage[]): RuntimeMessage[] {
  const commands = new Map<string, RuntimeToolRun>();
  const observations = new Map<RuntimeToolRun, RuntimeToolRun[]>();
  const mergedReads = new Set<RuntimeToolRun>();
  for (const message of messages) {
    for (const run of message.toolRuns ?? []) {
      const processId = shellResultProcessId(run);
      if (!processId) continue;
      const key = `${message.turnId ?? ''}\0${processId}`;
      if (isShellCommandRun(run)) {
        commands.set(key, run);
      } else if (isShellOutputRead(run) && (run.status === 'running' || run.status === 'success' || run.status === 'error')) {
        const command = commands.get(key);
        if (!command) continue;
        mergedReads.add(run);
        if (run.status === 'running') continue;
        const results = observations.get(command) ?? [];
        results.push(run);
        observations.set(command, results);
      }
    }
  }
  if (!mergedReads.size) return messages;

  return messages.map((message) => {
    if (!message.toolRuns?.some((run) => observations.has(run) || mergedReads.has(run))) return message;
    return {
      ...message,
      toolRuns: message.toolRuns.map((run): TranscriptToolRun => {
        if (mergedReads.has(run)) return { ...run, shellOutputMerged: true };
        const results = observations.get(run);
        if (!results) return run;
        const latest = results[results.length - 1];
        return {
          ...run,
          status: latest.status,
          data: latest.data ?? run.data,
          completedAt: latest.completedAt ?? run.completedAt,
          resultPreview: mergeShellProcessPreviews([run, ...results]),
        };
      }),
    };
  });
}

function shellResultProcessId(run: RuntimeToolRun): string {
  const data = isRecord(run.data) ? run.data : {};
  const resultId = stringField(data.process_id)
    || shellContentLine(run.resultPreview ?? '', /^Process Id:\s*(.+)$/im);
  if (resultId || !isShellOutputRead(run)) return resultId;
  const args = recordFromJson(run.argumentsPreview);
  const inputId = args.process_id ?? args.processId ?? args.session_id;
  return typeof inputId === 'number' ? String(inputId) : stringField(inputId);
}

function mergeShellProcessPreviews(runs: RuntimeToolRun[]): string {
  const parts = runs.map((run) => {
    const preview = normalizeShellResultPreview(run.resultPreview);
    const streamStart = preview.search(/^(?:stdout|stderr|error):/im);
    return streamStart < 0
      ? { header: preview, output: '' }
      : { header: preview.slice(0, streamStart), output: preview.slice(streamStart) };
  });
  // Only the latest observation owns process metadata. Keep every output chunk
  // and earlier warnings; retaining old running notices would hide later chunks.
  const warnings = parts.slice(0, -1).flatMap(({ header }) => header.split('\n')
    .filter((line) => !shellMetadataLine(line)));
  return [...warnings, parts[parts.length - 1].header, ...parts.map(({ output }) => output)]
    .filter(Boolean).join('\n');
}
