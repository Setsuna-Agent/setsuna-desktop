import { Boxes } from 'lucide-react';

/** Shared glyph for inline Skill selection and persisted Plugin usage records. */
export function ChatCapabilityReferenceIcon() {
  return (
    <span className="chat-capability-reference-icon" aria-hidden="true">
      <Boxes size={14} strokeWidth={1.8} />
    </span>
  );
}
