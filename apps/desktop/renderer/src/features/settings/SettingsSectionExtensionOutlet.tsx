import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  settingsPageExtensionSlot,
  type SettingsPageExtensionEntryDescriptor,
  type SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useState, type ReactNode } from 'react';
import {
  RendererOwnedKeyedSlot,
  useRendererOwnedKeyedEntries,
} from '../../kernel/renderer-plugins/RendererKernelProvider.js';

type ActiveSubpage = Readonly<{
  extensionId: string;
  subpageId: string;
}>;

/**
 * Keeps nested Feature settings in the host page lifecycle. Opening a subpage
 * replaces the parent section content and back restores it, matching native
 * settings navigation without giving Features control of the app router.
 * Host-owned trailing content stays after every Feature extension.
 */
export function SettingsSectionExtensionOutlet({
  children,
  sectionId,
  trailingContent,
  translate,
  ui,
}: Readonly<{
  children: ReactNode;
  sectionId: string;
  trailingContent?: ReactNode;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const extensions = useRendererOwnedKeyedEntries(settingsPageExtensionSlot)
    .filter((entry) => entry.metadata.targetSectionId === sectionId)
    .sort(compareExtensions);
  const [active, setActive] = useState<ActiveSubpage | null>(null);
  const activeExtension = active
    ? extensions.find((extension) => extension.metadata.id === active.extensionId)
    : undefined;
  const activeSubpage = activeExtension?.metadata.subpageIds.includes(active?.subpageId ?? '');

  if (activeExtension && activeSubpage && active) {
    return (
      <RendererOwnedKeyedSlot
        entryKey={activeExtension.key}
        slot={settingsPageExtensionSlot}
        props={{
          mode: {
            kind: 'subpage',
            onBack: () => setActive(null),
            subpageId: active.subpageId,
          },
          sectionId,
          translate,
          ui,
        }}
      />
    );
  }

  return (
    <>
      {children}
      {extensions.length ? (
        <div className="chat-user-settings__section-extensions">
          {extensions.map((extension) => {
            return (
              <RendererOwnedKeyedSlot
                key={extension.entryId}
                entryKey={extension.key}
                slot={settingsPageExtensionSlot}
                props={{
                  mode: {
                    kind: 'section',
                    openSubpage: (subpageId) => {
                      if (!extension.metadata.subpageIds.includes(subpageId)) {
                        throw new Error(`Unknown settings subpage: ${extension.metadata.id}:${subpageId}`);
                      }
                      setActive({ extensionId: extension.metadata.id, subpageId });
                    },
                  },
                  sectionId,
                  translate,
                  ui,
                }}
              />
            );
          })}
        </div>
      ) : null}
      {trailingContent}
    </>
  );
}

function compareExtensions(
  left: SettingsPageExtensionEntryDescriptor,
  right: SettingsPageExtensionEntryDescriptor,
): number {
  return left.metadata.order - right.metadata.order || left.entryId.localeCompare(right.entryId);
}
