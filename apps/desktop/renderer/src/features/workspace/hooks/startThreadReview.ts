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
 * 审查可以作为首个轮次。启动前先创建并选中对应项目线程，让调用方可从序号零开始订阅，
 * 并接收每一条已持久化的审查事件。
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
