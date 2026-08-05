import { ChevronDown } from 'lucide-react';
import {
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { CodePatchView } from '../../../shared/code/PierreCode.js';
import { codeDiffLinesToPatch } from '../../../shared/code/diffPatch.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  limitRuntimeFileChangePreview,
  type RuntimeFileChange,
} from './runtimeFileChanges.js';

export function RuntimeFileDiffDisclosure({
  change,
  summary,
}: {
  change: RuntimeFileChange;
  summary: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(event.currentTarget.open);
  };

  return (
    <details className="chat-file-diff__disclosure" onToggle={handleToggle}>
      <summary className="chat-tool-run__inspection-item chat-file-diff__summary">
        {summary}
        <ChevronDown aria-hidden="true" className="chat-file-diff__chevron" size={12} />
      </summary>
      {expanded ? <RuntimeFileDiffPreview change={change} /> : null}
    </details>
  );
}

export function RuntimeFileDiffPreview({ change }: { change: RuntimeFileChange }) {
  const { t } = useI18n();
  const previewChange = useMemo(() => limitRuntimeFileChangePreview(change), [change]);
  const patch = useMemo(() => codeDiffLinesToPatch(previewChange), [previewChange]);

  return (
    <div
      className="chat-file-diff__preview"
      role="region"
      aria-label={t('toolRun.file.diff.label', { path: previewChange.path })}
    >
      <div className="chat-file-diff__viewport">
        <CodePatchView patch={patch} />
      </div>
      {previewChange.truncated ? (
        <div className="chat-file-diff__truncated">
          {t('toolRun.file.diff.truncated')}
        </div>
      ) : null}
    </div>
  );
}
