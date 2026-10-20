import type { SequencedThreadEventRecord } from '@setsuna-desktop/feature-core/events';
import { ATTACH_PULL_REQUEST_TOOL, attachedPullRequest, parsePullRequestUrl, pullRequestKey, pullRequestUrl, referenceCodec, type PullRequestReference } from '../contracts/index.js';
import { array, codec, object, text } from '../contracts/schema.js';

export const attachmentProjectionCodec = codec(object({
  attachments: array(attachedPullRequest),
  processes: array(object({ id: text(256), urls: array(text(8192)) })),
}));
export type AttachmentProjection = ReturnType<typeof attachmentProjectionCodec.parse>;
export const emptyAttachments = (): AttachmentProjection => ({ attachments: [], processes: [] });

/** Only successful creation results count; links in chat, searches and PR reads are not associations. */
export function reduceThreadAttachments(state: AttachmentProjection, event: SequencedThreadEventRecord): AttachmentProjection {
  if (event.type !== 'tool.completed') return state;
  const payload = record(event.payload);
  const name = typeof payload.toolName === 'string' ? payload.toolName : '';
  const data = record(payload.data);
  const args = record(parseJson(payload.argumentsPreview));
  const processId = String(data.process_id ?? args.process_id ?? args.processId ?? args.session_id ?? '');
  const pending = state.processes.find((item) => item.id === processId);
  if (payload.status !== 'success') return pending
    ? { ...state, processes: state.processes.filter((item) => item.id !== processId) } : state;
  if (name === ATTACH_PULL_REQUEST_TOOL && data.resultKind === 'pull-requests.attachment') {
    try { return attach(state, [referenceCodec.parse(data.reference)], event.createdAt); }
    catch { return state; }
  }
  if (/(?:^|[_ .-])create_pull_request$/u.test(name) || data.toolName === 'create_pull_request') {
    const response = record(data.result);
    if (response.isError === true || data.isError === true) return state;
    // MCP previews can be truncated; use the retained structured/text result first.
    const contents = Array.isArray(response.content) ? response.content.map((block) => parseJson(record(block).text)) : [];
    for (const candidate of [response.structuredContent, ...contents, parseJson(payload.content), data]) {
      const result = record(candidate);
      const pr = record(result.pull_request ?? result);
      const reference = parsePullRequestUrl(pr.html_url ?? pr.url);
      if (reference) return attach(state, [reference], event.createdAt);
    }
    return state;
  }
  const command = args.command ?? args.cmd;
  const creates = ['run_shell_command', 'exec_command', 'shell'].includes(name) && typeof command === 'string'
    && /(?:^|&&|\|\||;|\n)\s*gh(?:\.exe)?\s+pr\s+create(?:\s|$)/u.test(command);
  const polls = ['read_shell_process', 'write_shell_process', 'write_stdin'].includes(name) && !args.input && !args.chars;
  if (!creates && !(pending && polls)) return state;
  // gh prints the created URL on its own line. Quoted PRs inside a body are not scanned.
  const urls = [...new Set([...(pending?.urls ?? []), ...standaloneUrls(payload.content)])];
  const processes = state.processes.filter((item) => item.id !== processId);
  if (data.running === true || data.status === 'running') {
    return processId ? { ...state, processes: [...processes, { id: processId, urls }] } : state;
  }
  const next = pending ? { ...state, processes } : state;
  if (data.exit_code != null && data.exit_code !== 0) return next;
  return attach(next, urls.flatMap((url) => { const pr = parsePullRequestUrl(url); return pr ? [pr] : []; }), event.createdAt);
}

function attach(state: AttachmentProjection, references: PullRequestReference[], attachedAt: string): AttachmentProjection {
  const existing = new Set(state.attachments.map(pullRequestKey));
  const added = references.filter((pr) => { const key = pullRequestKey(pr); if (existing.has(key)) return false; existing.add(key); return true; });
  return added.length ? { ...state, attachments: [...state.attachments, ...added.map((pr) => ({ ...pr, url: pullRequestUrl(pr), attachedAt }))] } : state;
}
function standaloneUrls(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\r?\n/u).map((line) => line.trim()).filter((line) => parsePullRequestUrl(line)) : [];
}
function parseJson(value: unknown): unknown { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
