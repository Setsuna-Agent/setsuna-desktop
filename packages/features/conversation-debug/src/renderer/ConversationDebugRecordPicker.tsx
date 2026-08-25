import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useConversationDebugI18n } from './context.js';
import type { ConversationDebugRecord } from './conversationDebugGraph.js';
import {
  groupConversationDebugRecords,
  isConversationDebugRecordGroup,
} from './conversationDebugRecordGroups.js';
import {
  conversationDebugRecordKind,
  conversationDebugRecordSequenceLabel,
  isRuntimeDebugTrace,
} from './conversationDebugTraces.js';
import { useConversationDebugUi } from './host-ui.js';

export function ConversationDebugRecordPicker({
  records,
  selectedRecordId,
  onSelectRecord,
}: Readonly<{
  records: ConversationDebugRecord[];
  selectedRecordId: string | null;
  onSelectRecord: (record: ConversationDebugRecord) => void;
}>) {
  const { t } = useConversationDebugI18n();
  const { IconButton, SelectField } = useConversationDebugUi();
  const options = useMemo(() => {
    return groupConversationDebugRecords(records).flatMap((item) => {
      if (!isConversationDebugRecordGroup(item)) {
        return [{ label: recordLabel(item), record: item }];
      }
      return item.records.map((record, index) => ({
        label: `${recordLabel(record)} · ${t('feature.conversationDebug.records.groupPosition', {
          count: item.records.length,
          index: index + 1,
        })}`,
        record,
      }));
    });
  }, [records, t]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.record.id === selectedRecordId),
  );
  const selectedOption = options[selectedIndex] ?? null;
  const selectRecordById = (recordId: string) => {
    const option = options.find((item) => item.record.id === recordId);
    if (option) onSelectRecord(option.record);
  };

  return (
    <div className="conversation-debug-inspector__events">
      <header>
        <strong>{t('feature.conversationDebug.recordsInNode', { count: records.length })}</strong>
        <span>
          {t('feature.conversationDebug.inspector.recordPosition', {
            count: options.length,
            index: options.length ? selectedIndex + 1 : 0,
          })}
        </span>
      </header>
      <div className="conversation-debug-inspector__record-navigation">
        <IconButton
          className="app-shell-icon-control conversation-debug-inspector__record-step"
          disabled={selectedIndex <= 0}
          label={t('feature.conversationDebug.inspector.previousRecord')}
          onClick={() => {
            const previous = options[selectedIndex - 1];
            if (previous) onSelectRecord(previous.record);
          }}
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </IconButton>
        <SelectField
          aria-label={t('feature.conversationDebug.inspector.selectRecord')}
          className="conversation-debug-inspector__record-select"
          disabled={!selectedOption}
          value={selectedOption?.record.id ?? ''}
          onValueChange={selectRecordById}
        >
          {options.map((option) => (
            <option key={recordKey(option.record)} value={option.record.id}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <IconButton
          className="app-shell-icon-control conversation-debug-inspector__record-step"
          disabled={!options.length || selectedIndex >= options.length - 1}
          label={t('feature.conversationDebug.inspector.nextRecord')}
          onClick={() => {
            const next = options[selectedIndex + 1];
            if (next) onSelectRecord(next.record);
          }}
        >
          <ChevronRight aria-hidden="true" size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function recordLabel(record: ConversationDebugRecord): string {
  return `${conversationDebugRecordSequenceLabel(record)} · ${conversationDebugRecordKind(record)}`;
}

function recordKey(record: ConversationDebugRecord): string {
  return `${isRuntimeDebugTrace(record) ? 'trace' : 'event'}:${record.id}`;
}
