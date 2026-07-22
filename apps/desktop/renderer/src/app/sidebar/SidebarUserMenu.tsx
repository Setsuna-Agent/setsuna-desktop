import { Settings } from 'lucide-react';

export function SidebarUserMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="chat-sidebar-user">
      <button
        className="chat-sidebar-user__trigger"
        type="button"
        aria-label="打开设置"
        onClick={onOpenSettings}
      >
        <Settings size={15} />
        <span className="chat-sidebar-user__name">设置</span>
      </button>
    </div>
  );
}
