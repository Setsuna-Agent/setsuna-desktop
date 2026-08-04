import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import {
  fileLanguage,
  highlightedDiffLinesHtml,
} from '../../../shared/lib/codeHighlight.js';
import type {
  RuntimeFileChange,
  RuntimeFileDiffLine,
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
  const language = fileLanguage(change.path);
  const highlightedLines = useMemo(
    () => highlightedDiffLinesHtml(change.lines, language),
    [change.lines, language],
  );

  return (
    <div
      className="chat-file-diff__preview"
      role="region"
      aria-label={t('toolRun.file.diff.label', { path: change.path })}
    >
      <div className="chat-file-diff__viewport">
        {change.lines.map((line, index) => (
          <RuntimeFileDiffRow
            highlighted={highlightedLines[index]}
            key={`${line.type}:${line.oldLine ?? ''}:${line.newLine ?? ''}:${index}`}
            language={language}
            line={line}
            t={t}
          />
        ))}
      </div>
      {change.truncated ? (
        <div className="chat-file-diff__truncated">
          {t('toolRun.file.diff.truncated')}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeFileDiffRow({
  highlighted,
  language,
  line,
  t,
}: {
  highlighted?: string;
  language: string;
  line: RuntimeFileDiffLine;
  t: Translate;
}) {
  if (line.type === 'gap') {
    return (
      <div className="chat-file-diff__gap">
        <ChevronsUpDown aria-hidden="true" size={11} />
        <span>{localizedGapContent(line.content, t)}</span>
      </div>
    );
  }

  const lineNumber = line.newLine ?? line.oldLine ?? line.lineNumber;
  const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
  const codeClassName = [
    'chat-file-diff__code',
    language ? `language-${language}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`chat-file-diff__line chat-file-diff__line--${line.type}`}>
      <span className="chat-file-diff__line-number">{lineNumber ?? ''}</span>
      <span aria-hidden="true" className="chat-file-diff__marker">{marker}</span>
      {highlighted !== undefined ? (
        <code
          className={codeClassName}
          dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
        />
      ) : (
        <code className={codeClassName}>{line.content || ' '}</code>
      )}
    </div>
  );
}

function localizedGapContent(content: string, t: Translate): string {
  const normalized = content.trim();
  const lineCount = /^(\d+) unmodified lines?$/iu.exec(normalized)?.[1];
  if (lineCount) return t('toolRun.file.diff.unmodifiedLines', { count: Number(lineCount) });
  if (!normalized || normalized === '...') return t('toolRun.file.diff.omitted');
  return normalized;
}
