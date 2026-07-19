const STARTUP_SPLASH_DATA_URL_PREFIX = 'data:text/html;base64,';

export const STARTUP_SPLASH_SHIMMER_DURATION_MS = 5_000;

const fallbackLogoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path fill="#858991" d="M32 4.5c1.9 0 3.7.5 5.3 1.4l17 9.8a10.5 10.5 0 0 1 5.2 9.1v14.4c0 3.7-2 7.2-5.2 9.1l-17 9.8a10.5 10.5 0 0 1-10.5 0l-17-9.8a10.5 10.5 0 0 1-5.3-9.1V24.8c0-3.7 2-7.2 5.3-9.1l17-9.8A10.5 10.5 0 0 1 32 4.5Zm0 8.1c-.5 0-1 .1-1.4.4l-17 9.8a2.5 2.5 0 0 0-1.2 2.1v14.3c0 .9.5 1.7 1.2 2.1l17 9.8c.9.5 1.9.5 2.8 0l17-9.8c.8-.4 1.2-1.2 1.2-2.1V24.9c0-.9-.5-1.7-1.2-2.1l-17-9.8c-.4-.3-.9-.4-1.4-.4Z"/>
  <path fill="#858991" d="M43.7 19.5v8.8c0 1.4-1.5 2.3-2.7 1.6l-5.6-3.4a6.7 6.7 0 0 0-6.9 0l-7.2 4.3a6.8 6.8 0 0 0-3.3 5.8v8.2l7 4.1v-9.7c0-1.4.7-2.7 1.9-3.4l5.1-3 5 3a8.7 8.7 0 0 0 13.2-7.5v-4.7l-6.5-4.1Z"/>
  <circle cx="32" cy="38.2" r="4.3" fill="#858991"/>
  <path fill="#858991" d="m35.6 40.5 14.2 8.6-6.6 3.8-14-8.5 6.4-3.9Z"/>
</svg>`;

const fallbackLogoDataUrl = `data:image/svg+xml;base64,${Buffer.from(fallbackLogoSvg).toString('base64')}`;

export function createStartupSplashPageUrl(logoDataUrl?: string): string {
  const html = createStartupSplashHtml(normalizeLogoDataUrl(logoDataUrl));
  return `${STARTUP_SPLASH_DATA_URL_PREFIX}${Buffer.from(html).toString('base64')}`;
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

function createStartupSplashHtml(logoDataUrl: string): string {
  const shimmerDurationSeconds = STARTUP_SPLASH_SHIMMER_DURATION_MS / 1_000;
  return `<!doctype html>
<html lang="zh-CN">
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
        opacity: 0.34;
        filter: grayscale(1) contrast(1.05) brightness(0.8);
        mix-blend-mode: multiply;
      }

      .setsuna-logo__highlight {
        opacity: 0.58;
        filter: grayscale(1) contrast(1.12) brightness(1.55);
        mix-blend-mode: screen;
        -webkit-mask-image: linear-gradient(
          105deg,
          transparent 4%,
          rgba(0, 0, 0, 0.12) 30%,
          #000 48%,
          rgba(0, 0, 0, 0.2) 68%,
          transparent 96%
        );
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-size: 48% 100%;
        mask-image: linear-gradient(
          105deg,
          transparent 4%,
          rgba(0, 0, 0, 0.12) 30%,
          #000 48%,
          rgba(0, 0, 0, 0.2) 68%,
          transparent 96%
        );
        mask-repeat: no-repeat;
        mask-size: 48% 100%;
        animation: setsuna-logo-shimmer ${shimmerDurationSeconds}s cubic-bezier(0.22, 0.7, 0.35, 1) infinite;
        will-change: mask-position, -webkit-mask-position;
      }

      @keyframes setsuna-logo-shimmer {
        0% {
          -webkit-mask-position: -95% 0;
          mask-position: -95% 0;
        }
        18%,
        100% {
          -webkit-mask-position: 195% 0;
          mask-position: 195% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .setsuna-logo__highlight {
          display: none;
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="setsuna-logo" role="status" aria-label="Setsuna Desktop 正在启动">
      <img class="setsuna-logo__layer setsuna-logo__base" src="${logoDataUrl}" alt="" />
      <img class="setsuna-logo__layer setsuna-logo__highlight" src="${logoDataUrl}" alt="" />
    </div>
  </body>
</html>`;
}
