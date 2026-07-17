const pluginIconNames = [
  'context7',
  'openai-docs',
  'pdf',
  'guard-dangerous-shell',
  'protect-secret-paths',
  'protect-generated-folders',
  'audit-file-mutations',
  'session-start-project-guidance',
  'prompt-secret-detector',
  'compact-warning',
  'stop-todo-continuation',
] as const;

type PluginIconName = typeof pluginIconNames[number];

const knownPluginIcons = new Set<string>(pluginIconNames);

export function CapabilitiesPluginIcon({
  name,
  variant = 'card',
}: {
  name?: string;
  variant?: 'card' | 'detail' | 'editorial' | 'list';
}) {
  const icon = name && knownPluginIcons.has(name) ? name as PluginIconName : 'plugin';

  return (
    <span
      className={`desktop-plugin-icon desktop-plugin-icon--${variant}`}
      data-plugin-icon={icon}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {pluginGlyph(icon)}
      </svg>
    </span>
  );
}

function pluginGlyph(icon: PluginIconName | 'plugin') {
  switch (icon) {
    case 'context7':
      return (
        <>
          <path d="M8.2 4.5H7.1A2.1 2.1 0 0 0 5 6.6v2.1c0 1.2-.7 2.3-1.8 2.8 1.1.5 1.8 1.6 1.8 2.8v2.1a2.1 2.1 0 0 0 2.1 2.1h1.1" />
          <path d="M11.6 6.5h7l-4.5 11" />
          <path d="M11.2 11.7h5.6" />
        </>
      );
    case 'openai-docs':
      return (
        <>
          <path d="M4 6c2.9-.8 5.4 0 8 1.7v10.8c-2.6-1.7-5.1-2.5-8-1.7V6Z" />
          <path d="M20 6c-2.9-.8-5.4 0-8 1.7v10.8c2.6-1.7 5.1-2.5 8-1.7V6Z" />
          <path d="m17.5 2.8.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45.45-1.2Z" />
        </>
      );
    case 'pdf':
      return (
        <>
          <path d="M6 3.5h8l4 4v13H6v-17Z" />
          <path d="M14 3.5v4h4" />
          <path d="M8.7 12h6.6M8.7 15h5.1M8.7 18h3.2" />
        </>
      );
    case 'guard-dangerous-shell':
      return (
        <>
          <path d="M3.5 5.5h17v13h-17z" />
          <path d="m7 10 2 2-2 2M11.5 14h3" />
          <path d="m17.5 3 2 1v2.2c0 1.5-.8 2.8-2 3.5-1.2-.7-2-2-2-3.5V4l2-1Z" />
        </>
      );
    case 'protect-secret-paths':
      return (
        <>
          <path d="M3.5 7h6l1.7 2H20v10.5H3.5V7Z" />
          <rect x="9" y="11.8" width="6" height="5" rx="1" />
          <path d="M10.5 11.8v-1a1.5 1.5 0 0 1 3 0v1M12 14.2v1" />
        </>
      );
    case 'protect-generated-folders':
      return (
        <>
          <path d="M3.5 7h6l1.7 2H20v10.5H3.5V7Z" />
          <circle cx="13.8" cy="14.2" r="3.2" />
          <path d="m11.5 16.5 4.6-4.6" />
        </>
      );
    case 'audit-file-mutations':
      return (
        <>
          <path d="M5 3.5h9l3 3V13" />
          <path d="M14 3.5v3h3M5 3.5v17h7" />
          <circle cx="16.2" cy="16.2" r="3.2" />
          <path d="m18.6 18.6 2 2M8 10h5M8 13h3" />
        </>
      );
    case 'session-start-project-guidance':
      return (
        <>
          <path d="M4 6.2c2.8-.8 5.3 0 8 1.6v10.5c-2.7-1.6-5.2-2.4-8-1.6V6.2Z" />
          <path d="M20 6.2c-2.8-.8-5.3 0-8 1.6v10.5c2.7-1.6 5.2-2.4 8-1.6V6.2Z" />
          <path d="m12 3 1.2 2.1L12 7.2l-1.2-2.1L12 3Z" />
        </>
      );
    case 'prompt-secret-detector':
      return (
        <>
          <path d="M4 5h16v11H9l-4 3v-3H4V5Z" />
          <circle cx="11" cy="10.2" r="1.7" />
          <path d="M12.7 10.2h4l1 1-1 1-.8-.8-.9.9" />
        </>
      );
    case 'compact-warning':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m8 8.5 3 3M11 8.5v3H8M16 15.5l-3-3M13 15.5v-3h3" />
        </>
      );
    case 'stop-todo-continuation':
      return (
        <>
          <path d="M5 5h10v14H5V5Z" />
          <path d="m7.5 9 1 1 2-2M7.5 14h4" />
          <path d="M15.5 9.5A4 4 0 1 1 14 16.9" />
          <path d="m14.2 14.5-.2 2.4 2.4.2" />
        </>
      );
    default:
      return <path d="M9.2 4H5v5.2a2.8 2.8 0 1 1 0 5.6V20h5.2a2.8 2.8 0 1 1 5.6 0H20v-5.2a2.8 2.8 0 1 1 0-5.6V4h-4.2a2.8 2.8 0 1 1-6.6 0Z" />;
  }
}
