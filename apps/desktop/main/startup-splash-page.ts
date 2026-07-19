const STARTUP_SPLASH_DATA_URL_PREFIX = 'data:text/html;base64,';
const STARTUP_SPLASH_WINDOW_ACTION_PROTOCOL = 'setsuna-startup-action:';

export const STARTUP_SPLASH_SHIMMER_DURATION_MS = 5_000;

export type StartupSplashWindowAction = 'close' | 'minimize' | 'toggle-maximize';

export interface StartupSplashPageOptions {
  windowControls?: boolean;
}

const fallbackLogoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path fill="#858991" d="M32 4.5c1.9 0 3.7.5 5.3 1.4l17 9.8a10.5 10.5 0 0 1 5.2 9.1v14.4c0 3.7-2 7.2-5.2 9.1l-17 9.8a10.5 10.5 0 0 1-10.5 0l-17-9.8a10.5 10.5 0 0 1-5.3-9.1V24.8c0-3.7 2-7.2 5.3-9.1l17-9.8A10.5 10.5 0 0 1 32 4.5Zm0 8.1c-.5 0-1 .1-1.4.4l-17 9.8a2.5 2.5 0 0 0-1.2 2.1v14.3c0 .9.5 1.7 1.2 2.1l17 9.8c.9.5 1.9.5 2.8 0l17-9.8c.8-.4 1.2-1.2 1.2-2.1V24.9c0-.9-.5-1.7-1.2-2.1l-17-9.8c-.4-.3-.9-.4-1.4-.4Z"/>
  <path fill="#858991" d="M43.7 19.5v8.8c0 1.4-1.5 2.3-2.7 1.6l-5.6-3.4a6.7 6.7 0 0 0-6.9 0l-7.2 4.3a6.8 6.8 0 0 0-3.3 5.8v8.2l7 4.1v-9.7c0-1.4.7-2.7 1.9-3.4l5.1-3 5 3a8.7 8.7 0 0 0 13.2-7.5v-4.7l-6.5-4.1Z"/>
  <circle cx="32" cy="38.2" r="4.3" fill="#858991"/>
  <path fill="#858991" d="m35.6 40.5 14.2 8.6-6.6 3.8-14-8.5 6.4-3.9Z"/>
</svg>`;

const fallbackLogoDataUrl = `data:image/svg+xml;base64,${Buffer.from(fallbackLogoSvg).toString('base64')}`;

export function createStartupSplashPageUrl(
  logoDataUrl?: string,
  options: StartupSplashPageOptions = {},
): string {
  const html = createStartupSplashHtml(normalizeLogoDataUrl(logoDataUrl), options);
  return `${STARTUP_SPLASH_DATA_URL_PREFIX}${Buffer.from(html).toString('base64')}`;
}

export function createStartupSplashWindowActionUrl(action: StartupSplashWindowAction): string {
  return `${STARTUP_SPLASH_WINDOW_ACTION_PROTOCOL}//${action}`;
}

export function startupSplashWindowActionFromUrl(value: string): StartupSplashWindowAction | null {
  try {
    const url = new URL(value);
    if (url.protocol !== STARTUP_SPLASH_WINDOW_ACTION_PROTOCOL || (url.pathname !== '' && url.pathname !== '/')) {
      return null;
    }
    if (url.hostname === 'close' || url.hostname === 'minimize' || url.hostname === 'toggle-maximize') {
      return url.hostname;
    }
  } catch {
    // Ignore malformed and unrelated navigation targets.
  }
  return null;
}

export function decodeStartupSplashPageUrl(pageUrl: string): string {
  if (!pageUrl.startsWith(STARTUP_SPLASH_DATA_URL_PREFIX)) {
    throw new Error('Startup splash page URL is invalid.');
  }
  return Buffer.from(pageUrl.slice(STARTUP_SPLASH_DATA_URL_PREFIX.length), 'base64').toString('utf8');
}

function normalizeLogoDataUrl(value?: string): string {
  if (value && /^data:image\/(?:png|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  return fallbackLogoDataUrl;
}

function createStartupSplashHtml(logoDataUrl: string, options: StartupSplashPageOptions): string {
  const shimmerDurationSeconds = STARTUP_SPLASH_SHIMMER_DURATION_MS / 1_000;
  const windowControls = options.windowControls ? createWindowControlsHtml() : '';
  return `<!doctype html>
<html lang="zh-CN" class="startup-splash-running">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"
    />
    <meta name="color-scheme" content="light" />
    <title>Setsuna Desktop</title>
    <style>
      :root {
        color-scheme: light;
        background: #f7f6fa;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }

      body {
        display: grid;
        place-items: center;
        background: #f7f6fa;
        user-select: none;
        -webkit-app-region: drag;
      }

      .startup-window-controls {
        position: fixed;
        top: 0;
        right: 0;
        z-index: 3;
        display: flex;
        align-items: stretch;
        height: 34px;
        -webkit-app-region: no-drag;
      }

      .startup-window-controls__button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 34px;
        border: 0;
        color: #62646a;
        background: transparent;
        text-decoration: none;
      }

      .startup-window-controls__button:hover {
        color: #25262a;
        background: rgba(31, 35, 40, 0.08);
      }

      .startup-window-controls__button--close:hover {
        color: #fff;
        background: #e81123;
      }

      .startup-window-controls__button:focus-visible {
        outline: 1px solid rgba(76, 110, 245, 0.8);
        outline-offset: -2px;
      }

      .startup-window-controls svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.4;
      }

      .setsuna-logo {
        position: relative;
        width: 54px;
        height: 54px;
        isolation: isolate;
        overflow: hidden;
        border-radius: 13px;
      }

      .setsuna-logo__layer {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
        -webkit-user-drag: none;
      }

      .setsuna-logo__base {
        opacity: 0.38;
        filter: grayscale(1) contrast(1.05) brightness(0.8);
        mix-blend-mode: multiply;
      }

      .setsuna-logo__highlight {
        z-index: 1;
        opacity: 0;
        filter: grayscale(1) contrast(0.72) brightness(2.25);
        -webkit-mask-image: linear-gradient(
          104deg,
          transparent 0%,
          rgba(0, 0, 0, 0.08) 24%,
          rgba(0, 0, 0, 0.48) 42%,
          #000 50%,
          rgba(0, 0, 0, 0.34) 60%,
          rgba(0, 0, 0, 0.06) 76%,
          transparent 100%
        );
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-size: 36% 100%;
        -webkit-mask-position: -90% 0;
        mask-image: linear-gradient(
          104deg,
          transparent 0%,
          rgba(0, 0, 0, 0.08) 24%,
          rgba(0, 0, 0, 0.48) 42%,
          #000 50%,
          rgba(0, 0, 0, 0.34) 60%,
          rgba(0, 0, 0, 0.06) 76%,
          transparent 100%
        );
        mask-repeat: no-repeat;
        mask-size: 36% 100%;
        mask-position: -90% 0;
        will-change: mask-position, -webkit-mask-position, opacity;
      }

      .startup-splash-running .setsuna-logo__highlight {
        animation: setsuna-logo-shimmer ${shimmerDurationSeconds}s linear infinite;
      }

      @keyframes setsuna-logo-shimmer {
        0% {
          -webkit-mask-position: -90% 0;
          mask-position: -90% 0;
          opacity: 0;
        }
        2% {
          opacity: 0.72;
        }
        25% {
          -webkit-mask-position: 190% 0;
          mask-position: 190% 0;
          opacity: 0.72;
        }
        29%,
        100% {
          -webkit-mask-position: 190% 0;
          mask-position: 190% 0;
          opacity: 0;
        }
      }
    </style>
  </head>
  <body>
    ${windowControls}
    <div class="setsuna-logo" role="status" aria-label="Setsuna Desktop is starting">
      <img class="setsuna-logo__layer setsuna-logo__base" src="${logoDataUrl}" alt="" />
      <img class="setsuna-logo__layer setsuna-logo__highlight" src="${logoDataUrl}" alt="" />
    </div>
  </body>
</html>`;
}

function createWindowControlsHtml(): string {
  return `<nav class="startup-window-controls" aria-label="Window controls">
      <a class="startup-window-controls__button" href="${createStartupSplashWindowActionUrl('minimize')}" aria-label="Minimize" title="&#26368;&#23567;&#21270;">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg>
      </a>
      <a class="startup-window-controls__button" href="${createStartupSplashWindowActionUrl('toggle-maximize')}" aria-label="Maximize" title="&#26368;&#22823;&#21270;">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="0.4" /></svg>
      </a>
      <a class="startup-window-controls__button startup-window-controls__button--close" href="${createStartupSplashWindowActionUrl('close')}" aria-label="Close" title="&#20851;&#38381;">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </a>
    </nav>`;
}
