import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import {
  ConversationDebugI18nProvider,
  ConversationDebugPanel,
  ConversationDebugUiProvider,
} from '@setsuna-desktop/feature-conversation-debug/renderer';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { CodeFileView } from '../shared/code/PierreCode.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { EmptyState, IconButton, SelectField } from '../shared/ui/primitives.js';
import { WorkspaceResizeHandle } from '../features/workspace/WorkspaceResizeHandle.js';
import { useConversationDebugFeatureService } from './ConversationDebugFeatureBoundary.js';

export function ConversationDebugFeaturePanel({
  eventSource,
  placement,
  thread,
  ...resizeProps
}: Readonly<{
  eventSource: Pick<DesktopRuntimeClient, 'subscribeEvents'>;
  placement: 'side' | 'bottom';
  thread: RuntimeThread | null;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}>) {
  const service = useConversationDebugFeatureService();
  const { locale, t } = useI18n();
  return (
    <ConversationDebugI18nProvider locale={locale} translate={t}>
      <ConversationDebugUiProvider ui={{
        CodeView: ConversationDebugCodeView,
        EmptyState,
        IconButton,
        ResizeHandle: WorkspaceResizeHandle,
        SelectField,
      }}>
        <ConversationDebugPanel
          {...resizeProps}
          eventSource={eventSource}
          placement={placement}
          service={service}
          thread={thread}
        />
      </ConversationDebugUiProvider>
    </ConversationDebugI18nProvider>
  );
}

const conversationDebugCodeStyle = {
  '--diffs-dark-bg': 'transparent',
  '--diffs-font-size': '10px',
  '--diffs-light-bg': 'transparent',
  '--diffs-line-height': '17px',
} as CSSProperties;

function ConversationDebugCodeView({
  'aria-label': ariaLabel,
  className,
  code,
  language,
}: Readonly<{
  'aria-label'?: string;
  className?: string;
  code: string;
  language: string;
}>) {
  return (
    <div aria-label={ariaLabel} className={className} role="region" tabIndex={0}>
      <CodeFileView
        contents={code}
        disableBackground
        language={shouldHighlightDebugCode(code) ? language : 'text'}
        name={`conversation-debug.${language === 'json' ? 'json' : 'txt'}`}
        showLineNumbers={false}
        style={conversationDebugCodeStyle}
        unsafeCSS="[data-code] { padding: 12px 14px 16px; }"
      />
    </div>
  );
}

function shouldHighlightDebugCode(code: string): boolean {
  if (code.length > 24_000) return false;
  let lines = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) !== 10) continue;
    lines += 1;
    if (lines > 500) return false;
  }
  return true;
}
