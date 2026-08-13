import type { ReactNode } from 'react';

export function SettingsPageHeading({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <header className="chat-user-settings__page-heading">
      <div className="chat-user-settings__page-heading-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
