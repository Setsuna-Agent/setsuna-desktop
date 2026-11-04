# WebDAV removal visual evidence (GitHub-hosted macOS only)

This harness **must not run on the shared management host**. It asserts both GitHub Actions and macOS before doing any work. The workflow builds baseline `25457e95898a67d617edb3c660c8709d2469664a` and the exact changed revision separately using the repository's pnpm scripts, then launches the actual Electron executable through isolated Playwright automation.

## Capture contract

- Real compiled Electron main, real preload bridge, real local runtime, real production renderer. No native bridge fixtures, DOM substitutions, hand-drawn UI, or mock screenshots.
- Each run gets a fresh isolated development profile. A disposable checkout-only launcher redirects Electron appData/userData, then imports the unchanged built main entry. The original package manifest is restored in `finally`.
- Set interface language using the real runtime config bridge; use the application's normal local-storage theme preference. Content viewport: **1440 × 1000**; light theme; en-US; reduced motion. Record the actual display scale in provenance.
- Navigate via the real **Open settings**, **General**, and **Proxy servers** buttons. General captures must show Sync before and not after. Proxy captures must show WebDAV sync before and not after. No WebDAV server or model-provider network credentials are needed.
- PNGs are emitted only after readiness and scenario assertions. Failures produce `FAILURE-not-evidence` diagnostics, never success evidence.
- JSON provenance records full commit SHA, Electron/Chromium versions, actual viewport, settings, and SHA-256 of each captured PNG.

## Review and PR linking

A successful workflow alone is not proof of visual correctness. Download the artifact using GitHub CLI, inspect all four successful PNGs, and check that the same scenario and framing are visible. Attach those images to the PR, or commit them into a dedicated evidence directory and link their GitHub URLs in the PR body. Include provenance and explicitly state **actual macOS Electron**, not browser-fixture capture. Workflow artifacts alone are not inline PR evidence.

Do not claim any screenshot exists until the hosted capture has actually succeeded. The harness was authored without local execution under the shared-host restriction; the hosted run is required to validate it.
