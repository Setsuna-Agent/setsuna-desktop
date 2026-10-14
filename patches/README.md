# Dependency patches

## @pierre/diffs 1.3.3: live editor cache

`@pierre__diffs@1.3.3.patch` keeps the renderer's live text cache during plain-text
editing so viewport refreshes do not replace inserted rows with the original
file. It also preserves dynamic theme selection for light/dark theme pairs:
editor token updates must not set a fixed `baseThemeType` on a dual-theme result.
Otherwise, switching back to light mode can reuse a background pinned to dark
mode while the editor has already refreshed its tokens. Explicit single themes
retain their fixed base mode.

The fix updates the existing renderer cache in place; it does not remount the
editor or discard drafts, selections or undo history. The editor interaction
test covers typing, repeated theme changes and saving with that state intact.
When upgrading, verify both behaviors before removing this patch.

## @silurus/ooxml 0.88.0: continuous DOCX sections

`@silurus__ooxml@0.88.0.patch` aligns the section flow-domain overlap check in
`packages/docx/src/layout/page-factory.ts` with the single-ULP comparison already
used by that release's `layout/invariants.ts`. Reconstructing a shared edge as
`start + (end - start)` can round one representable value above `end`, causing
valid continuous sections to be rejected as physically overlapping. The patch
does not change document content, section placement or pagination; overlaps
larger than floating-point precision are still rejected.

The npm package publishes compiled JavaScript, so both the main-thread chunk
`document-pull-client-B9PTM-pL.js` and the self-contained DOCX render worker
`assets/render-worker-BlvJybji.js` need the same fix. Most of the patch size is
the unchanged context of the minified worker's long line. `pnpm` applies it at
install time; no runtime rewriting, startup work or extra dependency is added.

The synthetic `continuous-sections.docx` fixture in the offline Electron preview
integration test exercises parsing, painting and text preservation in both modes.
When upgrading this pinned dependency, check the upstream page-factory comparison
and remove the patch once the fixture passes against an unpatched release.

Upstream source:
- https://github.com/yukiyokotani/office-open-xml-viewer/blob/v0.88.0/packages/docx/src/layout/page-factory.ts
- https://github.com/yukiyokotani/office-open-xml-viewer/blob/v0.88.0/packages/docx/src/layout/invariants.ts
