import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}`;
await writeFile('web.json', JSON.stringify({
  pid: process.pid, executable: process.execPath, electronNode: process.env.ELECTRON_RUN_AS_NODE ?? null, url,
}));
console.log(`ready: ${url}`);
