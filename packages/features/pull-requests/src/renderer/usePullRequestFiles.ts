import { useEffect, useState } from 'react';
import type { PullRequestDetail } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';
import { useSessionData, type FilesSnapshot, type PullRequestDetailData } from './reading/session-data.js';

const emptyFiles: FilesSnapshot = { files: [], nextPage: 1 };
export function usePullRequestFiles(client: PullRequestsClient, detail: PullRequestDetail, activePath: string | null, data: PullRequestDetailData) {
  const { repository, number, baseSha, headSha } = detail;
  const version = JSON.stringify([repository, number, baseSha, headSha]);
  const [snapshot, setSnapshot] = useSessionData(data.files, version, emptyFiles);
  const files = snapshot.files;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    void (async () => {
      try {
        // A diff is immutable for a base/head pair. Resume unfinished pages and reuse completed reads.
        const saved = data.files.getSnapshot();
        let page: number | null = saved?.key === version ? saved.value.nextPage : 1;
        while (page !== null) {
          const result = await client.files({ repository, number, baseSha, headSha, page }, controller.signal);
          if (controller.signal.aborted) return;
          setSnapshot((current) => ({
            files: [...new Map([...(result.reset ? [] : current.files), ...result.files].map((file) => [file.path, file])).values()],
            nextPage: result.nextPage,
          }));
          page = result.nextPage;
        }
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [client, repository, number, baseSha, headSha, version, revision, data.files, setSnapshot]);

  // An old path may have been reused by a new file in the same PR.
  const selectedFile = activePath
    ? files.find((file) => file.path === activePath) ?? files.find((file) => file.previousPath === activePath)
    : undefined;
  const path = selectedFile?.path ?? (!activePath || !loading ? files[0]?.path ?? null : null);
  const key = JSON.stringify([repository, number, baseSha, headSha, path]);
  const [patch, setPatch] = useSessionData(data.patch, key, null);
  const [patchError, setPatchError] = useState({ key, error: '' });
  useEffect(() => {
    setPatchError({ key, error: '' });
    if (!path) return;
    if (data.patch.getSnapshot()?.key === key) return;
    const controller = new AbortController();
    void client.patch({ repository, number, baseSha, headSha, path }, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPatch(value);
    }).catch((cause) => { if (!controller.signal.aborted) setPatchError({ key, error: errorText(cause) }); });
    return () => controller.abort();
  }, [client, repository, number, baseSha, headSha, path, key, revision, data.patch, setPatch]);
  return { files, loading, error, path, patch, patchError: patchError.key === key ? patchError.error : '', retry: () => setRevision((value) => value + 1) };
}
