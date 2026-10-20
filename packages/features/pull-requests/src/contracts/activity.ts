import { actor, reference } from './models.js';
import { array, choice, codec, cursor, httpsUrl, nodeId, nullable, object, oid, text } from './schema.js';

const activityEvent = object({
  id: nodeId, createdAt: text(50), actor: nullable(actor),
  kind: choice([
    'opened', 'closed', 'reopened', 'merged', 'ready-for-review', 'draft',
    'auto-merge-enabled', 'auto-squash-enabled', 'auto-rebase-enabled', 'auto-merge-disabled',
    'queued', 'dequeued', 'commit',
  ]),
  commit: nullable(object({ sha: oid, message: text(), url: httpsUrl })),
});
export type PullRequestActivityEvent = ReturnType<typeof activityEvent>;
export const activityInputCodec = codec((value: unknown) => ({
  ...reference(value), ...object({ cursor })(value),
}));
export type PullRequestActivityInput = ReturnType<typeof activityInputCodec.parse>;
export const activityResultCodec = codec(object({ items: array(activityEvent), cursor }));
export type PullRequestActivityResult = ReturnType<typeof activityResultCodec.parse>;
