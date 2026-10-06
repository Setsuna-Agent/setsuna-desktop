# Provider logo assets

The main catalog uses the installed `@lobehub/icons-static-svg@1.95.1` package from [LobeHub](https://github.com/lobehub/lobe-icons).
Vite bundles its primary SVG marks as local image assets, with color variants preferred where available.
The library is MIT licensed; see `LICENSE.lobehub.txt` and the packaged `THIRD_PARTY_NOTICES.md`.

`lobehub-catalog.json` contains names and search aliases from the installed release's source commit.
After upgrading the dependency, run `pnpm sync:brand-icons` to refresh this metadata.
The sync command validates that every primary SVG has metadata; icon lookup and search do not access the network at runtime.

Local overrides preserve existing preset keys and the following assets:

`kimi.svg` and `kimi-dark.svg` come from Kimi's official brand guide and provide the intended light- and dark-theme marks.

`sakana.svg` wraps the official favicon downloaded from `https://sakana.ai/favicon.ico` on 2026-07-20.

`glm.png` is the user-provided Zhipu GLM favicon used for GLM model-family matching.

These brand marks are used only to identify configured model providers and model families. Brand names and logos remain trademarks of their respective owners.
