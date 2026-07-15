import type {
  DesktopRuntimeClient,
  RuntimeReviewTarget,
  RuntimeThread,
  SendTurnResponse,
} from '@setsuna-desktop/contracts';

type ThreadReviewClient = Pick<DesktopRuntimeClient, 'createThread' | 'startReview'>;

type StartThreadReviewOptions = {
  activeProjectId: string | null;
  client: ThreadReviewClient;
  currentThread: RuntimeThread | null;
  onThreadCreated: (thread: RuntimeThread) => void | Promise<unknown>;
  target: RuntimeReviewTarget;
};

/**
 * Review is a valid first turn. Create and select its project thread before starting so
 * the caller can subscribe from sequence zero and receive every persisted review event.
 */
export async function startThreadReview({
  activeProjectId,
  client,
  currentThread,
  onThreadCreated,
  target,
}: StartThreadReviewOptions): Promise<SendTurnResponse> {
  let thread = currentThread;
  if (!thread) {
    if (!activeProjectId) throw new Error('请先选择项目');
    thread = await client.createThread({ projectId: activeProjectId });
    await onThreadCreated(thread);
  }

  return client.startReview(thread.id, target);
}
