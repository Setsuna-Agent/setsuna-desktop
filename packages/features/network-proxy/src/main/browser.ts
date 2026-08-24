import { DESKTOP_BROWSER_PARTITION } from '@setsuna-desktop/feature-browser/contracts';
import { app, session, type AuthInfo, type Event, type WebContents } from 'electron';
import type { DesktopNetworkProxyService } from './service.js';

const LOOPBACK_BYPASS_RULES = 'localhost;127.0.0.1;[::1]';

/** Keeps the persistent embedded-browser Session aligned with desktop proxy routing. */
export class DesktopBrowserProxyController {
  private applyQueue: Promise<void> = Promise.resolve();
  private currentSignature = '';
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly service: DesktopNetworkProxyService) {}

  async start(): Promise<void> {
    app.on('login', this.handleLogin);
    this.unsubscribe = this.service.subscribe(() => {
      void this.enqueueApply(true).catch((error) => {
        console.error('[network-proxy] Failed to update embedded browser proxy.', error);
      });
    });
    try {
      await this.enqueueApply(true);
    } catch (error) {
      // Keep Settings reachable when an encrypted password can no longer be read
      // or a configured relay cannot start. The session remains fail-closed until
      // the user repairs the proxy configuration.
      console.error('[network-proxy] Failed to initialize embedded browser proxy.', error);
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    app.off('login', this.handleLogin);
  }

  private enqueueApply(failClosed = false): Promise<void> {
    const apply = async () => {
      try {
        await this.apply();
      } catch (error) {
        if (failClosed) await this.blockNetwork();
        throw error;
      }
    };
    const run = this.applyQueue.then(apply, apply);
    this.applyQueue = run.catch(() => undefined);
    return run;
  }

  private async apply(): Promise<void> {
    const route = await this.service.resolve({ scope: 'browser' });
    const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
    const signature = route.mode === 'proxy' ? route.proxyUrl : route.mode;
    if (signature === this.currentSignature) return;
    if (route.mode === 'system') {
      await browserSession.setProxy({ mode: 'system' });
    } else if (route.mode === 'direct') {
      await browserSession.setProxy({ mode: 'direct' });
    } else {
      const relay = new URL(route.proxyUrl);
      await browserSession.setProxy({
        mode: 'fixed_servers',
        proxyBypassRules: LOOPBACK_BYPASS_RULES,
        proxyRules: `http://${relay.hostname}:${relay.port}`,
      });
    }
    if (this.currentSignature) {
      await browserSession.clearAuthCache();
      await browserSession.closeAllConnections();
    }
    this.currentSignature = signature;
  }

  private async blockNetwork(): Promise<void> {
    const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
    await browserSession.setProxy({
      mode: 'fixed_servers',
      proxyBypassRules: LOOPBACK_BYPASS_RULES,
      // Port 9 is intentionally not opened by Setsuna. Keeping a fixed, dead
      // endpoint prevents a failed proxy reconfiguration from reverting to direct.
      proxyRules: 'http://127.0.0.1:9',
    });
    await browserSession.closeAllConnections();
    this.currentSignature = 'blocked';
  }

  private readonly handleLogin = (
    event: Event,
    webContents: WebContents,
    _details: Electron.AuthenticationResponseDetails,
    authInfo: AuthInfo,
    callback: (username?: string, password?: string) => void,
  ): void => {
    if (!authInfo.isProxy || webContents.session !== session.fromPartition(DESKTOP_BROWSER_PARTITION)) return;
    const credentials = this.service.credentialsForLoopbackGateway(authInfo.host, authInfo.port);
    if (!credentials) return;
    event.preventDefault();
    callback(credentials.username, credentials.password);
  };
}
