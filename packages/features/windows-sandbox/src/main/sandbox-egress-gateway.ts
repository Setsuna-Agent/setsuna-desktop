import {
  DESKTOP_WINDOWS_SANDBOX_PROXY_PORTS,
  type DesktopSandboxNetworkEnvironment,
} from '../contracts/index.js';
import { randomBytes } from 'node:crypto';
import { Server as ProxyChainServer } from 'proxy-chain';
import {
  assertSandboxEgressHostname,
  sandboxEgressDnsLookup,
} from './sandbox-egress-policy.js';

const PROXY_ENVIRONMENT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
] as const;

type SandboxEgressGatewayOptions = {
  ports?: readonly number[];
  resolveUpstreamProxy(): Promise<string | undefined>;
};

type RunningSandboxEgressGateway = {
  authenticatedUrl: string;
  servers: ProxyChainServer[];
};

/**
 * Gives the network-enabled Windows sandbox one authenticated loopback exit.
 * WFP permits only this fixed port range; upstream credentials stay in main.
 */
export class SandboxEgressGateway {
  private readonly ports: readonly number[];
  private running: RunningSandboxEgressGateway | null = null;
  private starting: Promise<RunningSandboxEgressGateway> | null = null;

  constructor(private readonly options: SandboxEgressGatewayOptions) {
    this.ports = options.ports ?? DESKTOP_WINDOWS_SANDBOX_PROXY_PORTS;
  }

  async environment(): Promise<DesktopSandboxNetworkEnvironment> {
    assertDirectSandboxEgress(await this.options.resolveUpstreamProxy());
    const gateway = await this.start();
    return {
      ...Object.fromEntries(PROXY_ENVIRONMENT_KEYS.map((key) => [key, gateway.authenticatedUrl])),
      // A bypass would ask the sandbox to connect to a port WFP intentionally blocks.
      NO_PROXY: '',
    };
  }

  async close(): Promise<void> {
    const starting = this.starting;
    this.starting = null;
    const running = this.running ?? await starting?.catch(() => null) ?? null;
    this.running = null;
    await Promise.all(running?.servers.map((server) => (
      server.close(true).catch(() => undefined)
    )) ?? []);
  }

  private start(): Promise<RunningSandboxEgressGateway> {
    if (this.running) return Promise.resolve(this.running);
    if (this.starting) return this.starting;
    const starting = this.create();
    this.starting = starting;
    void starting.then((running) => {
      if (this.starting === starting) {
        this.running = running;
        this.starting = null;
      }
    }, () => {
      if (this.starting === starting) this.starting = null;
    });
    return starting;
  }

  private async create(): Promise<RunningSandboxEgressGateway> {
    if (!this.ports.length) throw new Error('Windows sandbox proxy port range is empty.');
    const username = `setsuna-sandbox-${randomBytes(8).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    const servers: ProxyChainServer[] = [];

    try {
      for (const port of this.ports) {
        const server = new ProxyChainServer({
          authRealm: 'Setsuna Desktop Sandbox',
          host: '127.0.0.1',
          port,
          prepareRequestFunction: async ({
            hostname,
            password: suppliedPassword,
            username: suppliedUsername,
          }) => {
            if (suppliedUsername !== username || suppliedPassword !== password) {
              return { requestAuthentication: true };
            }
            assertSandboxEgressHostname(hostname);
            const upstreamProxyUrl = await this.options.resolveUpstreamProxy();
            assertDirectSandboxEgress(upstreamProxyUrl);
            return {
              // The validated address is handed to the same direct socket, which
              // prevents DNS rebinding between policy and connection setup.
              dnsLookup: sandboxEgressDnsLookup,
            };
          },
        });
        server.on('requestFailed', ({ error }: { error?: unknown }) => {
          console.warn(`[windows-sandbox] Egress relay failed: ${errorMessage(error)}`);
        });
        await server.listen();
        servers.push(server);
      }
      const authenticatedUrl = new URL(`http://127.0.0.1:${servers[0]!.port}`);
      authenticatedUrl.username = username;
      authenticatedUrl.password = password;
      return { authenticatedUrl: authenticatedUrl.toString(), servers };
    } catch (error) {
      await Promise.all(servers.map((server) => server.close(true).catch(() => undefined)));
      const detail = errorCode(error) === 'EADDRINUSE'
        ? 'at least one reserved port is already in use'
        : errorMessage(error);
      throw new Error(
        `Windows sandbox proxy could not reserve its complete port range (${this.ports.join(', ')}): ${detail}.`,
        { cause: error },
      );
    }
  }
}

function assertDirectSandboxEgress(upstreamProxyUrl: string | undefined): void {
  if (!upstreamProxyUrl) return;
  throw new Error(
    'Windows sandbox egress cannot safely use an upstream proxy because the upstream controls DNS; select a direct runtime route.',
  );
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : errorCode((error as { cause?: unknown }).cause);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}
