import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';

/** Exposes only the downloaded archive, never a directory or a remote redirect. */
export async function createMacUpdateFeed(archivePath: string, version: string) {
  const archive = await stat(archivePath);
  if (!archive.isFile() || archive.size === 0) throw new Error('The macOS update archive is empty or missing.');
  const token = randomBytes(32).toString('hex');
  const feedPath = `/${token}/feed`;
  const archiveRoute = `/${token}/update.zip`;
  let origin = '';
  const server = createServer((request, response) => {
    // A random capability URL and exact Host check keep other local web pages
    // from discovering the archive through the loopback server.
    if (request.headers.host !== new URL(origin).host || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    if (request.url === feedPath) {
      const body = JSON.stringify({ url: `${origin}${archiveRoute}`, name: version });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
      return;
    }
    if (request.url !== archiveRoute) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': archive.size });
    void pipeline(createReadStream(archivePath), response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start the macOS update feed.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}${feedPath}`,
    archiveUrl: `${origin}${archiveRoute}`,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
