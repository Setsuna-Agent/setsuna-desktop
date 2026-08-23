import type {
  RegisteredSettingsSectionExtension,
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useState, type ReactNode } from 'react';

type ActiveSubpage = Readonly<{
  extensionId: string;
  subpageId: string;
}>;

/**
 * Keeps nested Feature settings in the host page lifecycle. Opening a subpage
 * replaces the parent section content and back restores it, matching native
 * settings navigation without giving Features control of the app router.
 */
export function SettingsSectionExtensionOutlet({
  children,
  extensions,
  sectionId,
  translate,
  ui,
}: Readonly<{
  children: ReactNode;
  extensions: readonly RegisteredSettingsSectionExtension[];
  sectionId: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [active, setActive] = useState<ActiveSubpage | null>(null);
  const activeExtension = active
    ? extensions.find((extension) => extension.id === active.extensionId)
    : undefined;
  const activeSubpage = activeExtension?.subpages?.find((subpage) => subpage.id === active?.subpageId);

  if (activeSubpage) {
    const Subpage = activeSubpage.render;
    return (
      <Subpage
        sectionId={sectionId}
        translate={translate}
        ui={ui}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <>
      {children}
      {extensions.length ? (
        <div className="chat-user-settings__section-extensions">
          {extensions.map((extension) => {
            const Extension = extension.render;
            return (
              <Extension
                key={`${extension.featureId}:${extension.id}`}
                sectionId={extension.targetSectionId}
                translate={translate}
                ui={ui}
                openSubpage={(subpageId) => {
                  if (!extension.subpages?.some((subpage) => subpage.id === subpageId)) {
                    throw new Error(`Unknown settings subpage: ${extension.id}:${subpageId}`);
                  }
                  setActive({ extensionId: extension.id, subpageId });
                }}
              />
            );
          })}
        </div>
      ) : null}
    </>
  );
}
