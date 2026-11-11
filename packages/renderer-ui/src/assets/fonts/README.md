# Figtree

The unmodified Latin variable WOFF2 comes from `@fontsource-variable/figtree@5.3.0`
(`files/figtree-latin-wght-normal.woff2`, font revision v9).

- Upstream: https://github.com/erikdkennedy/figtree
- Distribution: https://registry.npmjs.org/@fontsource-variable/figtree/-/figtree-5.3.0.tgz
- License: SIL Open Font License 1.1; see `OFL.txt`.
- Weight range: 300–900; normal style. Other scripts use the host font fallback.

`styles/fonts.css` loads the font locally with `font-display: swap`. The renderer
build emits the WOFF2 as a static asset; `prepare-app-sdk-assets.mjs` copies this
directory with the shared CSS so independent apps have the same offline font.
