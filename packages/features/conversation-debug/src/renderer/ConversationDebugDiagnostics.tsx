import type { ConversationDebugInspectorModel } from './conversationDebugInspectorModel.js';
import { useConversationDebugUi } from './host-ui.js';

export function ConversationDebugDiagnostics({
  model,
}: Readonly<{
  model: ConversationDebugInspectorModel;
}>) {
  const { CodeView } = useConversationDebugUi();
  return (
    <div className="conversation-debug-diagnostics">
      {model.notices.length ? (
        <section
          aria-labelledby="conversation-debug-diagnostics-notices"
          className="conversation-debug-diagnostics__notices"
        >
          <h3 id="conversation-debug-diagnostics-notices">{model.noticesTitle}</h3>
          <div>
            {model.notices.map((notice) => (
              <article
                className={`conversation-debug-diagnostics__notice conversation-debug-diagnostics__notice--${notice.tone}`}
                key={notice.id}
              >
                <i aria-hidden="true" />
                <span>
                  <strong>{notice.title}</strong>
                  <p>{notice.message}</p>
                </span>
                {notice.code ? <code>{notice.code}</code> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {model.sections.map((section) => {
        const headingId = `conversation-debug-diagnostics-${section.id}`;
        return (
          <section
            aria-labelledby={headingId}
            className="conversation-debug-diagnostics__section"
            key={section.id}
          >
            <h3 id={headingId}>{section.title}</h3>
            <dl>
              {section.fields.map((field) => (
                <div
                  className={[
                    field.wide ? 'is-wide' : '',
                    field.monospace ? 'is-monospace' : '',
                    field.language ? 'has-code' : '',
                  ].filter(Boolean).join(' ')}
                  key={field.id}
                >
                  <dt>
                    <span>{field.label}</span>
                    {field.path ? <code title={field.path}>{field.path}</code> : null}
                  </dt>
                  <dd title={!field.language && field.value.length <= 240 ? field.value : undefined}>
                    {field.language ? (
                      <CodeView
                        aria-label={field.label}
                        className="conversation-debug-diagnostics__code"
                        code={field.value}
                        language={field.language}
                      />
                    ) : field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
