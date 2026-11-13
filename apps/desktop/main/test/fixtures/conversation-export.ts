import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, nativeImage, session } from 'electron';
import { saveConversationExport } from '../../src/conversation-export/save-conversation-export.js';
import { prepareConversationExport } from '../../src/conversation-export/prepare-conversation-export.js';

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();
// Export destroys its only window before asynchronous file assertions complete.
app.on('window-all-closed', () => undefined);

async function main() {
  await app.whenReady();
  const exportSession = session.fromPartition('conversation-export', { cache: false });
  const requests: string[] = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2YQAAAABJRU5ErkJggg==', 'base64');
  exportSession.protocol.handle('https', (request) => {
    requests.push(new URL(request.url).pathname);
    return new Response(pixel, { headers: { 'content-type': 'image/png' } });
  });
  exportSession.protocol.handle('file', () => {
    requests.push('local-file');
    return new Response(pixel, { headers: { 'content-type': 'image/png' } });
  });
  const input = { title: 'Export', format: 'png', content: `<!doctype html><meta charset="utf-8">
    <h1>对话导出</h1><p>中文与 Markdown 内容</p><img src="https://export.test/image.png">
    <script>new Image().src = 'https://export.test/executed';</script>
    <iframe src="https://export.test/frame"></iframe><img src="file:///private.png">
    ${'<p>Long conversation content</p>'.repeat(100)}` };
  const saved = await prepareConversationExport(input, directory);
  assert.equal(saved.ok, true);
  const destination = saved.file.path;
  const png = await readFile(destination);
  assert.equal(saved.file.imageDataUrl, `data:image/png;base64,${png.toString('base64')}`, 'preview and saved file contain identical image bytes');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(nativeImage.createFromBuffer(png).isEmpty(), false);
  assert.deepEqual(requests, ['/image.png'], 'export content cannot execute scripts, load frames or read local files');
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'successful export releases its renderer');

  const tooLong = await saveConversationExport({ ...input, content: '<p>Long reply</p>'.repeat(2000) }, async () => destination);
  assert.equal(tooLong.ok, false, 'oversized images fail instead of silently cropping the conversation');
  assert.deepEqual(await readFile(destination), png, 'render failure preserves the existing destination');
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'failed export releases its renderer');
  console.log('CONVERSATION_PNG_OK');
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
