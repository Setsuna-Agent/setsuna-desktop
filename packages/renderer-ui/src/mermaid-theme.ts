import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = 'light' | 'dark';

/** Resolve host tokens before serializing: SVG images cannot inherit the page's CSS variables. */
export function createMermaidTheme(theme: MermaidTheme) {
  const styles = getComputedStyle(document.documentElement);
  const dark = theme === 'dark';
  const color = (name: string, light: string, darkColor: string) => (
    styles.getPropertyValue(name).trim() || (dark ? darkColor : light)
  );
  const surface = color('--app-surface', '#ffffff', '#202020');
  const subtle = color('--app-surface-subtle', '#fafafa', '#222222');
  const muted = color('--app-surface-muted', '#f5f5f5', '#282828');
  const border = color('--app-border-strong', '#d4d4d4', '#454545');
  const text = color('--app-text', '#242424', '#e4e4e4');
  const line = color('--app-text-muted', '#7d7d7d', '#9d9d9d');
  const fontFamily = styles.getPropertyValue('--app-font-family').trim() || 'system-ui, sans-serif';

  return {
    theme: 'base',
    look: 'classic',
    fontFamily,
    fontSize: 14,
    themeVariables: {
      darkMode: dark,
      background: surface,
      fontFamily,
      fontSize: '14px',
      primaryColor: surface,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: subtle,
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: muted,
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      lineColor: line,
      textColor: text,
      edgeLabelBackground: surface,
      clusterBkg: subtle,
      clusterBorder: border,
      radius: 8,
      strokeWidth: 1.25,
      useGradient: false,
      dropShadow: 'none',
    },
    themeCSS: '.node rect, .cluster rect { rx: 8px; ry: 8px; }',
    flowchart: {
      curve: 'basis',
      nodeSpacing: 28,
      rankSpacing: 36,
      padding: 12,
      diagramPadding: 8,
    },
  } satisfies MermaidConfig;
}
