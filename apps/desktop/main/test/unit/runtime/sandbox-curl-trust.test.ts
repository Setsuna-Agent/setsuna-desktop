import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareSandboxCurlTrustBundle } from '../../../src/runtime/sandbox-curl-trust.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

describe('prepareSandboxCurlTrustBundle', () => {
  it('combines the pinned Mozilla bundle with deduplicated Windows trust certificates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-curl-trust-'));
    temporaryRoots.push(root);
    const bundledCaPath = path.join(root, 'prepared-curl', 'curl-ca-bundle.crt');
    const destination = path.join(root, 'runtime', 'sandbox-trust', 'curl-ca-bundle.pem');
    await mkdir(path.dirname(bundledCaPath), { recursive: true });
    await writeFile(bundledCaPath, `${rootCertificates[0]}\n`, 'utf8');

    const result = await prepareSandboxCurlTrustBundle({
      bundledCaPath,
      destination,
      systemCertificates: [rootCertificates[1]!, rootCertificates[1]!],
    });
    const combined = await readFile(destination, 'utf8');
    const combinedFingerprints = [...combined.matchAll(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu,
    )].map((match) => new X509Certificate(match[0]).fingerprint256);

    expect(result).toEqual({ bundlePath: destination, systemCertificateCount: 1 });
    expect(combined).toContain(rootCertificates[0]!.trim());
    expect(combinedFingerprints).toContain(new X509Certificate(rootCertificates[1]!).fingerprint256);
    expect(combined.match(/Windows system trust certificates/gu)).toHaveLength(1);
  });
});
