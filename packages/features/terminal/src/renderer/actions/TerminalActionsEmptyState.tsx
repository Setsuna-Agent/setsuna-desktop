/** Decorative only; the settings heading already owns the add action. */
export function TerminalActionsEmptyState() {
  return <div className="feature-terminal-action-settings__empty" aria-hidden="true">
    <svg width="184" height="152" viewBox="0 0 184 152" fill="none" focusable="false">
      <ellipse cx="92" cy="76" rx="76" ry="64" fill="var(--app-surface-subtle)" />
      <ellipse cx="94" cy="132" rx="54" ry="4" fill="var(--app-surface-muted)" />
      <g transform="rotate(8 112 60)">
        <rect x="58" y="24" width="108" height="74" rx="12" fill="var(--app-surface-muted)" stroke="var(--app-border)" />
        <path d="M73 40H105M73 51H93" stroke="var(--app-border-strong)" strokeWidth="2" strokeLinecap="round" />
      </g>
      <rect x="22" y="46" width="132" height="80" rx="12" fill="var(--app-surface)" stroke="var(--app-border-strong)" />
      <path d="M23 68H153" stroke="var(--app-border)" />
      <g fill="var(--app-border-strong)">
        <circle cx="36" cy="57" r="2" />
        <circle cx="44" cy="57" r="2" />
        <circle cx="52" cy="57" r="2" />
      </g>
      <path d="M40 84L49 92L40 100M58 100H72" stroke="var(--app-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M90 86H132M90 98H118" stroke="var(--app-border)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </div>;
}
