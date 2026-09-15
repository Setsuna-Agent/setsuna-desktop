import { useEffect, useState } from 'react';
import type { PullRequestDetail, PullRequestFile, PullRequestPatch } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';

export function usePullRequestFiles(client: PullRequestsClient, detail: PullRequestDetail, activePath: string | null) {
  const [files, setFiles] = useState<PullRequestFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const { repository, number, baseSha, headSha } = detail;
  useEffect(() => {
    const controller = new AbortController();
    setFiles([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        let page: number | null = 1;
        while (page !== null) {
          const result = await client.files({ repository, number, baseSha, headSha, page }, controller.signal);
          if (controller.signal.aborted) return;
          setFiles((current) => [...new Map([...(result.reset ? [] : current), ...result.files].map((file) => [file.path, file])).values()]);
          page = result.nextPage;
        }
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [client, repository, number, baseSha, headSha, revision]);

  // An old path may have been reused by a new file in the same PR.
  const selectedFile = activePath
    ? files.find((file) => file.path === activePath) ?? files.find((file) => file.previousPath === activePath)
    : undefined;
  const path = selectedFile?.path ?? (!activePath || !loading ? files[0]?.path ?? null : null);
  const key = JSON.stringify([repository, number, baseSha, headSha, path]);
  const [patch, setPatch] = useState<{ key: string; value: PullRequestPatch | null; error: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void client.patch({ repository, number, baseSha, headSha, path }, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPatch({ key, value, error: '' });
    }).catch((cause) => { if (!controller.signal.aborted) setPatch({ key, value: null, error: errorText(cause) }); });
    return () => controller.abort();
  }, [client, repository, number, baseSha, headSha, path, key, revision]);
  return { files, loading, error, path, patch: patch?.key === key ? patch.value : null, patchError: patch?.key === key ? patch.error : '', retry: () => setRevision((value) => value + 1) };
}
