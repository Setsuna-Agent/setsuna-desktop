import { createServer, type Server, type ServerResponse } from 'node:http';
import { isIPv6, type BlockList } from 'node:net';
import type { DesignPreviewAccess, DesignPreviewIndex } from '../../contracts/design-publication.js';
import { designPreviewEndpoints, matchesPreviewAddress, type DesignPreviewBinding } from './design-preview-addresses.js';
import { designPreviewAccessHeader, designPreviewCredentials, designPreviewUnlockPath, previewAuthorizationMatches } from './design-preview-auth.js';
import { designViewerHtml, designViewerJs, type DesignViewerTheme } from './design-preview-viewer.js';
import { designViewerCss } from './design-preview-viewer-style.js';

export type DesignPreviewServer = Readonly<{ urls: readonly string[]; close(): Promise<void> }>;
export type DesignPreviewStoredFrame = Readonly<{ metadata: string; png: Buffer }>;

export async function openDesignPreview(bindings: readonly DesignPreviewBinding[], index: DesignPreviewIndex,
  images: readonly Buffer[], access: DesignPreviewAccess, theme: DesignViewerTheme, signal: AbortSignal,
  variants: ReadonlyMap<string, DesignPreviewStoredFrame> = new Map(),
): Promise<DesignPreviewServer> {
  signal.throwIfAborted();
  if (!bindings.length) throw new Error('No local addresses are available for the LAN preview.');
  const { linkToken, viewerToken, linkHeader, viewerHeader, unlock } = designPreviewCredentials(access);
  const metadata = JSON.stringify(index);
  const page = designViewerHtml(theme);
  let endpoints = new Map<string, BlockList>();
  let closing: Promise<void> | undefined;
  const server = createServer({ requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 1_000, maxHeaderSize: 4_096 },
    (request, response) => {
      const headers = request.headersDistinct;
      const host = headers.host?.length === 1 ? headers.host[0] : '';
      const endpoint = endpoints.get(host);
      if (!endpoint || !matchesPreviewAddress(endpoint, request.socket.localAddress)
        || (headers.origin && (headers.origin.length !== 1 || headers.origin[0] !== 'http://' + host))) {
        return send(response, 403);
      }
      const route = request.url ?? '';
      const supplied = headers.authorization?.length === 1 ? Buffer.from(headers.authorization[0]) : undefined;
      if (route === designPreviewUnlockPath && request.method === 'POST' && unlock) {
        response.setHeader('Connection', 'close');
        if (!previewAuthorizationMatches(supplied, linkHeader)) return send(response, 401);
        void unlock(request).then((status) => {
          if (status !== 200) return send(response, status);
          return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ token: viewerToken }));
        });
        return;
      }
      if (request.method !== 'GET' || request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0) {
        return send(response, 405);
      }
      if (route === '/') return send(response, 200, 'text/html; charset=utf-8', page);
      if (route === '/viewer.css') return send(response, 200, 'text/css; charset=utf-8', designViewerCss);
      if (route === '/viewer.js') return send(response, 200, 'text/javascript; charset=utf-8', designViewerJs);
      const board = /^\/api\/boards\/(0|[1-9]\d{0,3})\.png$/u.exec(route);
      const variant = /^\/api\/boards\/((?:0|[1-9]\d{0,3})\/(?:0|[1-9]\d{0,3}))\.(json|png)$/u.exec(route);
      if (route !== '/api/boards' && !board && !variant) return send(response, 404);
      if (!previewAuthorizationMatches(supplied, viewerHeader)) {
        if (unlock && previewAuthorizationMatches(supplied, linkHeader)) response.setHeader(designPreviewAccessHeader, 'password');
        return send(response, 401);
      }
      if (variant) {
        const frame = variants.get(variant[1]);
        if (!frame) return send(response, 404);
        return variant[2] === 'json' ? send(response, 200, 'application/json; charset=utf-8', frame.metadata) : send(response, 200, 'image/png', frame.png);
      }
      if (board) {
        const png = images[Number(board[1])];
        return png ? send(response, 200, 'image/png', png) : send(response, 404);
      }
      return send(response, 200, 'application/json; charset=utf-8', metadata);
    });
  server.maxConnections = 24;
  server.maxHeadersCount = 24;
  server.setTimeout(15_000, (socket) => socket.destroy());
  server.on('clientError', (_, socket) => socket.destroy());

  function close() {
    if (!closing) {
      closing = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    }
    return closing;
  }

  try {
    await listenOnAllInterfaces(server, bindings.some(({ address }) => isIPv6(address)));
    server.on('error', () => { void close(); });
    const listening = server.address();
    if (!listening || typeof listening === 'string') throw new Error('The LAN preview could not listen.');
    signal.throwIfAborted();
    endpoints = designPreviewEndpoints(bindings, listening.port, listening.family === 'IPv6');
    if (!endpoints.size) throw new Error('No local addresses are available for the LAN preview.');
    const urls = [...endpoints.keys()].map((host) => 'http://' + host + '/#' + linkToken);
    return { urls, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function listenOnAllInterfaces(server: Server, ipv6: boolean) {
  function listen(host: string) {
    return new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen(0, host);
    });
  }
  if (ipv6) {
    try {
      await listen('::');
      return;
    } catch (error) {
      if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  await listen('0.0.0.0');
}

function send(response: ServerResponse, status: number, type?: string, content?: string | Buffer) {
  if (response.destroyed) return;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    ...(status === 405 ? { Allow: 'GET', Connection: 'close' } : {}),
    ...(type ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(content!) } : {}),
  });
  response.end(content);
}
