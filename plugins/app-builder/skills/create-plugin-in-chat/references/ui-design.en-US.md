# Setsuna app UI guidelines

Use this as the default for generated sidebar apps. Explicit user styling takes precedence; preserve unrelated design when updating an app. These resources adapt the host's `shared/styles/tokens.css` and `renderer-ui/styles/{controls,table}.css` for the sandbox. Do not seek host source files or import React components.

## Structure and scale

| Element | Default |
| --- | --- |
| Font | `var(--setsuna-font-family)`; no remote fonts |
| Body / control / table | 14px / 13px / 12px; line-height 1.5 / 20px / 18px |
| Page / section heading | 20px / 14px, weight 600; one main heading per page |
| Spacing | 4, 8, 12, 16, 24, 32px; icon-label gap 6px, control gap 8px, within-group gap 16px, section/page inset 24px |
| Controls | 32px tall; horizontal padding 12px for buttons, 10px for inputs; align centers within rows |
| Corners | 8px inputs/icon buttons, 10px panels, pill action buttons; avoid nested large rounding |
| Icons | 16px outline SVG, `currentColor`, 1.75 stroke; no emoji substitutes |
| Tables | At least 48px rows, 8px 16px cell padding; right-align numeric columns with tabular numerals |

The CSS includes `sa-app`, `sa-page-header`, `sa-toolbar`, `sa-stack`, and `sa-grid`, plus buttons, fields, tables, panels, and states. Adapt layouts with a small amount of app CSS instead of inventing new spacing and styling per component.

- Place the title and necessary actions in one header row, with content below. Use panels only for independent groups; do not wrap every row in a large card.
- Accent the primary action; keep secondary actions neutral or transparent. Omit oversized hero titles, gradients, glass effects, large color blocks, and heavy shadows by default.
- Center icons and labels with `inline-flex; align-items:center`, not spaces or per-item offsets. Number badges use `line-height:1`.
- Use one `gap` per group and reset heading/content margins. Do not stack parent gaps with child margins.
- Wrap toolbars and collapse forms on narrow windows. Preserve readable table columns and scroll within their container. Set `min-width:0` on flex/grid children and `min-height:0` on viewport-filling scroll regions.
- Show only requested content and actions. Do not fill space with welcome copy, subtitles, feature descriptions, metric cards, permission summaries, or instructions. Give icon buttons `title` and `aria-label`.

## Theme colors

The sandbox inherits neither `--app-*` variables nor `.sd-*` styles. Use these host-supplied variables; the base CSS already does:

| Variable | Purpose |
| --- | --- |
| `--setsuna-color-surface` / `--setsuna-color-surface-muted` | Page/control backgrounds / headers and secondary surfaces |
| `--setsuna-color-text` / `--setsuna-color-text-muted` | Body / secondary text |
| `--setsuna-color-border` | Dividers and borders |
| `--setsuna-color-accent` / `--setsuna-color-accent-text` | Primary action/focus / primary action text |
| `--setsuna-color-danger` / `--setsuna-color-success` / `--setsuna-color-warning` | Actual error, success, and warning states |
| `--setsuna-font-family` | User-selected font stack |

Do not fix the page to white/black or infer the host theme from OS preferences. The host synchronizes colors and `color-scheme` through `setsunaUI`; CSS responds automatically. Derive hover/selection backgrounds with `color-mix`. Do not override host variables; use app-specific variables for explicit branding.

ECharts canvas/SVG options require concrete colors, not `var(...)`. Read variables from `getComputedStyle(document.documentElement)` after `setsunaUI.ready`, then update chart colors on snapshot notifications. The chart pattern includes this process.

## Components

- **Tables:** muted headers, light dividers, aligned headings and cells; deliberately truncate or wrap long text. Add sorting/filtering/selection only when requested. Use consistent action icons and tooltips.
- **Forms:** labels above controls, 8px label gaps and 16px field gaps; require fields based on actual business rules. Show errors at the field or submit location when needed; retain inputs after failures. No default permanent helper copy.
- **Charts:** use requested dimensions only; prefer the host accent for a single series and stable color ordering for multiple series. Light grids, 12px axis labels, transparent backgrounds, and clear units; no 3D, glow, or decorative graphics.
- **Interaction:** retain focus-visible and native button/control semantics. Prevent duplicate submission while pending. Hover changes color without moving controls; respect reduced-motion.
- **States:** show loading, empty, and error states only when they actually apply. Never invent records/charts for missing data or present draft/sample data as saved.

## Before delivery

Check theme variables, spacing, narrow-window overflow, keyboard focus, long titles, empty/error states, and actual save behavior. Do not open browsers or take styling screenshots unless requested; static inspection is not visual verification. `verify_plugin` validates data/actions, not appearance.
