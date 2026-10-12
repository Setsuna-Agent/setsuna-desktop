import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { SandboxedUiFrame } from '../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';

const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
let notify: (() => Promise<void>) | undefined;
Object.assign(window, { reactApp: {
  notify: () => notify?.(),
  unmount() { flushSync(() => root.render(null)); },
  async mount(source: RuntimeSandboxedUiSource, endpoint: string) {
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    let data = (await request('/state')).data;
    const render = () => root.render(<SandboxedUiFrame title="Notes" source={source} storageKey="react-notes/notes.page"
      data={data} context={{pluginId:'react-notes', contributionId:'notes.page'}} allowedActionIds={['notes.save']}
      onAction={async (actionId, payload) => { data = (await request('/action', { actionId, payload })).data; render(); }}
      onRuntimeRequest={input => request('/runtime', input)} />);
    notify = async () => { data = (await request('/state')).data; render(); };
    render();
  },
} });
