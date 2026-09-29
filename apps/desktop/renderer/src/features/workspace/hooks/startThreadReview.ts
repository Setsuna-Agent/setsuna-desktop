import type {
  CreateThreadInput,
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeInterfaceLanguage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import type {
  ReviewRendererService,
  ReviewTarget,
  StartReviewResult,
} from '@setsuna-desktop/feature-review/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

type ThreadReviewClient = Pick<DesktopRuntimeClient, 'createThread'>;

type StartThreadReviewOptions = {
  activeProjectId: string | null;
  client: ThreadReviewClient;
  currentThread: RuntimeThread | null;
  language: RuntimeInterfaceLanguage;
  modelSelection?: RuntimeConfiguredModelReference;
  workspaceMode?: CreateThreadInput['workspaceMode'];
  onThreadCreated: (thread: RuntimeThread) => void | Promise<unknown>;
  review: Pick<ReviewRendererService, 'start'>;
  t?: Translate;
  target: ReviewTarget;
};

/**
 * 审查可以作为首个轮次。启动前先创建并选中对应项目线程，让调用方可从序号零开始订阅，
 * 并接收每一条已持久化的审查事件。
 */
export async function startThreadReview({
  activeProjectId,
  client,
  currentThread,
  language,
  modelSelection,
  workspaceMode,
  onThreadCreated,
  review,
  t = defaultTranslate,
  target,
}: StartThreadReviewOptions): Promise<StartReviewResult> {
  let thread = currentThread;
  if (!thread) {
    if (!activeProjectId) throw new Error(t('chat.composer.selectProjectFirst'));
    thread = await client.createThread({ projectId: activeProjectId, ...(workspaceMode ? { workspaceMode } : {}) });
    await onThreadCreated(thread);
  }

  return review.start({
    threadId: thread.id,
    language,
    ...(modelSelection ? { modelSelection } : {}),
    target,
  });
}
