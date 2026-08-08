const STARTUP_SPLASH_DATA_URL_PREFIX = 'data:text/html;base64,';

export function decodeStartupSplashPageUrl(pageUrl: string): string {
  if (!pageUrl.startsWith(STARTUP_SPLASH_DATA_URL_PREFIX)) {
    throw new Error('Startup splash page URL is invalid.');
  }
  return Buffer.from(pageUrl.slice(STARTUP_SPLASH_DATA_URL_PREFIX.length), 'base64').toString('utf8');
}
