import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { designPackageImportStagingPrefix, designPackageStagingFile, designPackageStagingPrefix, importDesignPackage, prepareDesignPackage,
  resolveDesignDocumentRoot, type DesignDocumentRef, type DesignPackageManifest, type DesignPackageReceipt, type DesignSnapshot,
} from '@setsuna-desktop/feature-design/contracts';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

const documents = '/v1/features/design/documents';
const pixel = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
const box = { x: 0, y: 0, width: 96, height: 64 };

async function stage(harness: RuntimeServerTestHarness, prefix = designPackageStagingPrefix) {
  const ticket = randomUUID();
  const directory = path.join(harness.runtimeDataDir, 'runtime', prefix + ticket);
  await mkdir(directory);
  return { ticket, archive: path.join(directory, designPackageStagingFile) };
}

it('imports an exported draft and its dependencies under a fresh resource root, then edits the copy', async () => {
  const harness = await createRuntimeServerTestHarness();
  const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    await Promise.all(['screens', 'libraries', 'assets'].map((folder) => mkdir(path.join(source, folder), { recursive: true })));
    const outer = await post('/v1/projects', { path: source });
    const inner = await post('/v1/projects', { path: path.join(source, 'screens') });
    const entry = 'screens/首页.design.json';
    const library = 'libraries/photo.design.json';
    const foundation = 'libraries/foundation.design.json';
    const photo = 'assets/photo.png';
    const override = 'assets/替换.png';
    const shader = 'assets/texture.glsl';
    const texture = 'assets/texture.png';
    const script = 'assets/drawing.js';
    const documentId = 'screen';
    const original = JSON.stringify({ schemaVersion: 11, documentId,
      libraries: { photos: library, 'setsuna-library-beui-bundled': 'builtin:beui' },
      rootIds: ['instance', 'script', 'web', 'secret'],
      nodes: {
        instance: { ...box, kind: 'frame', childIds: [], instanceOf: 'photos:card',
          contentOverrides: { 'photos:image': { kind: 'image', assetPath: override } } },
        script: { ...box, kind: 'script', scriptPath: script },
        web: { ...box, kind: 'web', url: 'http://127.0.0.1:39999/' },
        secret: { ...box, kind: 'text', text: 'Hidden', hidden: true, fontSize: 14, fontFamily: 'Custom Family' },
      },
    }, null, 2) + '\n';
    const largePng = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    expect(largePng.length).toBeGreaterThan(64 * 1024);
    await Promise.all([
      writeFile(path.join(source, entry), original),
      writeFile(path.join(source, library), JSON.stringify({ schemaVersion: 12, documentId: 'photos', libraries: { foundation },
        rootIds: ['card'], nodes: { card: { ...box, kind: 'frame', childIds: ['image'], component: true,
          fills: [{ color: '#000000', shader: { assetPath: shader, uniforms: { image: { kind: 'image', assetPath: texture } } } }] },
        image: { ...box, kind: 'image', assetPath: photo } } })),
      writeFile(path.join(source, foundation), JSON.stringify({ schemaVersion: 1, documentId: 'foundation', rootIds: [], nodes: {} })),
      writeFile(path.join(source, photo), pixel), writeFile(path.join(source, override), pixel),
      writeFile(path.join(source, texture), largePng), writeFile(path.join(source, shader), 'void main() {}'),
      writeFile(path.join(source, script), 'return [];'),
      writeFile(path.join(source, 'screens', 'unrelated.design.json'), '{}'),
    ]);
    const unused = await post('/v1/features/design/images', {
      ref: { projectId: outer.id, path: entry }, name: 'unused.png', base64: ONE_PIXEL_PNG_BASE64,
    });
    const ref = { projectId: inner.id, path: path.basename(entry) };
    const saved: DesignSnapshot = await harness.runtimeFetch(documents + '?' + new URLSearchParams(ref));
    const { ticket, archive } = await stage(harness);
    const receipt: DesignPackageReceipt = await post(prepareDesignPackage.path, { ref, documentId, expectedRevision: saved.revision, ticket });
    expect(receipt.ticket).toBe(ticket);
    const unpacked = unzipSync(await readFile(archive));
    expect(Object.keys(unpacked).sort()).toEqual(['manifest.json',
      ...[entry, library, foundation, photo, override, shader, texture, script].map((file) => 'content/' + file)].sort());
    expect([...receipt.archive.entries].sort()).toEqual(Object.keys(unpacked).sort());
    expect(receipt.archive.remaining).toBe(0);
    expect(Buffer.from(unpacked['content/' + entry]).toString()).toBe(original);
    expect(Buffer.from(unpacked['content/' + texture]).equals(largePng)).toBe(true);
    expect(await readFile(path.join(source, entry), 'utf8')).toBe(original);
    expect(await readFile(path.join(source, unused))).toEqual(pixel);
    const manifest = JSON.parse(Buffer.from(unpacked['manifest.json']).toString()) as DesignPackageManifest;
    expect(manifest).toMatchObject({ formatVersion: 1, entry: 'content/' + entry, resourceRoot: 'content',
      externalDependencies: { webUrls: ['http://127.0.0.1:39999/'], fonts: { source: 'environment', declaredFamilies: ['Custom Family'] },
        builtinLibraries: [{ path: 'builtin:beui', documentId: 'setsuna-library-beui-bundled', revision: expect.any(String) }] } });

    const local = path.join(await realpath(path.join(harness.runtimeDataDir, 'runtime')), 'designs');
    await mkdir(path.join(local, 'Review'), { recursive: true });
    const existing = path.join(local, 'Review', 'existing.txt');
    await writeFile(existing, 'keep');
    const incoming = await stage(harness, designPackageImportStagingPrefix);
    await copyFile(archive, incoming.archive);
    const reopened: DesignDocumentRef = await post(importDesignPackage.path, {
      ticket: incoming.ticket, destination: { name: 'Review', scope: { storageId: 'local' }, linkedProjectId: outer.id },
    });
    const restored = path.join(local, 'Review 2', 'content');
    expect(reopened).toMatchObject({ storageId: expect.stringMatching(/^[a-f0-9]{64}$/u), path: entry });
    const { storageId } = reopened;
    if (!storageId) throw new Error('Expected the imported package to have its own storage scope.');
    const readImported = (path: string) => harness.runtimeFetch(documents + '?' + new URLSearchParams({ storageId, path }));
    const reopenedSnapshot: DesignSnapshot = await readImported(reopened.path);
    expect(reopenedSnapshot).toMatchObject({ document: { documentId }, workspaceRoot: restored, linkedProjectId: outer.id });
    expect(await readFile(path.join(restored, entry), 'utf8')).toBe(original);
    expect(await readFile(existing, 'utf8')).toBe('keep');
    await expect(harness.runtimeFetch(resolveDesignDocumentRoot.path + '?' + new URLSearchParams({
      storageId: 'local', path: 'Review 2/content/' + entry,
    }))).resolves.toEqual(reopened);
    await expect(readImported(library)).resolves.toMatchObject({
      document: { documentId: 'photos', libraries: { foundation } }, workspaceRoot: restored,
    });
    await expect(readImported(foundation)).resolves.toMatchObject({ document: { documentId: 'foundation' } });
    await expect(post('/v1/features/design/storage/images/read', { ref: reopened, path: override })).resolves.toMatchObject({ base64: ONE_PIXEL_PNG_BASE64 });
    expect(await readFile(path.join(restored, texture))).toEqual(largePng);
    expect(await readFile(path.join(restored, shader), 'utf8')).toBe('void main() {}');
    expect(await readFile(path.join(restored, script), 'utf8')).toBe('return [];');
    await expect(post(documents + '/edits', { ref: reopened, expectedRevision: reopenedSnapshot.revision,
      edits: [{ kind: 'remove', nodeId: 'secret' }] })).resolves.toMatchObject({ canUndo: true });
    expect(await readFile(path.join(source, entry), 'utf8')).toBe(original);
  } finally { await harness.close(); }
});

it('rejects invalid archives without exposing a partially imported draft', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const runtime = path.join(harness.runtimeDataDir, 'runtime');
    const local = path.join(runtime, 'designs');
    const sentinel = path.join(runtime, 'untouched.design.json');
    await writeFile(sentinel, 'keep');
    const draft = { schemaVersion: 12, documentId: 'screen', rootIds: [], nodes: {} };
    const files = (entry: string, document: unknown) => ({
      'manifest.json': Buffer.from(JSON.stringify({ formatVersion: 1, resourceRoot: 'content', entry })),
      [entry]: Buffer.from(JSON.stringify(document)),
    });
    const entry = 'content/screen.design.json';
    const damaged = Buffer.from(zipSync(files(entry, draft), { level: 0 }));
    damaged[damaged.indexOf(Buffer.from('"screen"')) + 1] = 'd'.charCodeAt(0);
    for (const [zip, code] of [
      [zipSync(files('content/../../../untouched.design.json', draft)), 'DESIGN_PACKAGE_INVALID_PATH'],
      [zipSync(files(entry, { ...draft, libraries: { missing: 'library.design.json' } })), 'DESIGN_PACKAGE_INVALID'],
      [damaged, 'DESIGN_PACKAGE_INVALID'],
    ] as const) {
      const incoming = await stage(harness, designPackageImportStagingPrefix);
      await writeFile(incoming.archive, zip);
      await expect(harness.runtimeFetch(importDesignPackage.path, { method: 'POST', body: JSON.stringify({
        ticket: incoming.ticket, destination: { name: 'Incoming', scope: { storageId: 'local' } },
      }) })).rejects.toThrow(code);
      expect(await readdir(local)).toEqual([]);
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
    }
  } finally { await harness.close(); }
});

it('publishes no ZIP when a design reference points to unrelated data, escapes the root, or aliases a portable path', async () => {
  const harness = await createRuntimeServerTestHarness();
  const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    const outside = path.join(harness.runtimeDataDir, 'outside');
    await Promise.all([mkdir(source), mkdir(outside)]);
    await writeFile(path.join(source, 'confidential.png'), 'Private project text.');
    await writeFile(path.join(outside, 'valid.png'), pixel);
    await symlink(outside, path.join(source, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const project = await post('/v1/projects', { path: source });
    const ref = { projectId: project.id, path: 'screen.design.json' };
    const documentId = 'screen';
    for (const [paths, code] of [
      [['confidential.png'], 'DESIGN_DEPENDENCY_UNAVAILABLE'],
      [['alias/valid.png'], 'DESIGN_DEPENDENCY_UNAVAILABLE'],
      [['assets/花.png', 'Assets/花.png'], 'DESIGN_PACKAGE_INVALID_PATH'],
    ] as const) {
      const rootIds = paths.map((_, index) => 'image-' + index);
      const nodes = Object.fromEntries(paths.map((assetPath, index) => [rootIds[index], { ...box, kind: 'image', assetPath }]));
      await writeFile(path.join(source, ref.path), JSON.stringify({ schemaVersion: 12, documentId, rootIds, nodes }));
      const { revision }: DesignSnapshot = await harness.runtimeFetch(documents + '?' + new URLSearchParams(ref));
      const { ticket, archive } = await stage(harness);
      await expect(post(prepareDesignPackage.path, { ref, documentId, ticket, expectedRevision: revision })).rejects.toThrow(code);
      await expect(readFile(archive)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally { await harness.close(); }
});
