import { useEffect, useState } from 'react';
import { designFileKey } from '../../contracts/index.js';
import type { DesignDocumentRef, DesignScriptParameter } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';
import { designScriptDirectory } from './design-script-source.js';

const noParameters: readonly DesignScriptParameter[] = [];

export function useDesignScriptParameters(client: DesignClient, ref: DesignDocumentRef, scriptPath: string | undefined,
  watchDirectories: WatchDesignDirectories | undefined) {
  const key = JSON.stringify([designFileKey(ref), scriptPath]);
  const [loaded, setLoaded] = useState<Readonly<{ key: string; parameters: readonly DesignScriptParameter[] }>>();
  useEffect(() => {
    if (!scriptPath) return;
    let controller: AbortController | undefined;
    function refresh(path: string) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      const publish = (parameters: readonly DesignScriptParameter[]) => {
        if (!signal.aborted) setLoaded({ key, parameters });
      };
      // Execution reports script load failures. A valid declaration stays usable even if evaluation fails.
      void client.readScriptParameters({ ...ref, scriptPath: path }, signal).then(publish, () => publish(noParameters));
    }
    const stop = watchDirectories?.([designScriptDirectory(scriptPath)], () => refresh(scriptPath), { contentExtensions: ['.js'] });
    refresh(scriptPath);
    return () => { controller?.abort(); stop?.(); };
  }, [client, key, ref, scriptPath, watchDirectories]);
  return loaded?.key === key ? loaded.parameters : noParameters;
}
