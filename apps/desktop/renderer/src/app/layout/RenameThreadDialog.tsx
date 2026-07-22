import { createPortal } from 'react-dom';
import { Button, TextField } from '../../shared/ui/primitives.js';

export function RenameThreadDialog({
  title,
  onCancel,
  onChange,
  onSave,
}: {
  title: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return createPortal(
    <div className="desktop-agent-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="desktop-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label="重命名对话"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header>
          <strong>重命名对话</strong>
        </header>
        <TextField autoFocus value={title} placeholder="对话标题" onChange={(event) => onChange(event.target.value)} />
        <footer>
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim()}>
            保存
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
