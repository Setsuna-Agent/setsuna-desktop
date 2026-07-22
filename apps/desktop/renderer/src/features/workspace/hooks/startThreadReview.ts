import type {
  DesktopRuntimeClient,
  RuntimeReviewTarget,
  RuntimeThread,
  SendTurnResponse,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

type ThreadReviewClient = Pick<DesktopRuntimeClient, 'createThread' | 'startReview'>;

type StartThreadReviewOptions = {
  activeProjectId: string | null;
  client: ThreadReviewClient;
  currentThread: RuntimeThread | null;
  onThreadCreated: (thread: RuntimeThread) => void | Promise<unknown>;
  t?: Translate;
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
  t = defaultTranslate,
  target,
}: StartThreadReviewOptions): Promise<SendTurnResponse> {
  let thread = currentThread;
  if (!thread) {
    if (!activeProjectId) throw new Error(t('chat.composer.selectProjectFirst'));
    thread = await client.createThread({ projectId: activeProjectId });
    await onThreadCreated(thread);
  }

  return client.startReview(thread.id, target);
}
