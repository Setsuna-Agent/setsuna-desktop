import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { createRoot } from 'react-dom/client';
import { SandboxedUiFrame } from '../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';

const root = createRoot(document.body);
let revision = 0;

const forms = {
  async run(source: RuntimeSandboxedUiSource) {
    const current = ++revision;
    const stats = { actions: 0, runtimeRequests: 0, cancelled: false };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Plugin form did not complete')); }, 10_000);
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
      const receive = (event: MessageEvent) => {
        if (event.source !== document.querySelector('iframe')?.contentWindow || event.data?.type !== 'test-result') return;
        cleanup(); resolve({ result: event.data, stats });
      };
      window.addEventListener('message', receive);
      const render = (updated = false) => root.render(<SandboxedUiFrame key={current} title="Forms" source={source}
        data={{ private: updated ? 'updated snapshot' : 'initial snapshot' }} context={{ private: 'context' }}
        allowedActionIds={['todo.add']} onAction={async () => { stats.actions++; }} onRuntimeRequest={request} />);
      const request = (_input: unknown, signal: AbortSignal) => {
        stats.runtimeRequests++;
        return new Promise<{ ok: true; status: number; data: { private: string } }>(done => {
          signal.addEventListener('abort', () => {
            stats.cancelled = true;
            // A late response and a new snapshot must stay isolated from the response page.
            done({ ok: true, status: 200, data: { private: 'late response' } });
            render(true);
            document.documentElement.dataset.theme = 'dark';
          }, { once: true });
        });
      };
      render();
    });
  },
};

Object.assign(window, { forms });
