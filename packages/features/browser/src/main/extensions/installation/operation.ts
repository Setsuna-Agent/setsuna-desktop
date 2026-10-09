/** Native loading and consent can outlive a request; scope shutdown must not wait for them. */
export function waitForExtensionOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(signal.reason); };
    signal.addEventListener('abort', cancelled, { once: true });
    operation.then((value) => {
      signal.removeEventListener('abort', cancelled);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, (error) => { signal.removeEventListener('abort', cancelled); reject(error); });
    if (signal.aborted) cancelled();
  });
}
