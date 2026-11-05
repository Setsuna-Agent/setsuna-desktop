import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { RuntimeApiResponse, RuntimePluginUiDataResult, RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { SandboxedUiFrame } from '../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';

declare const requestReactAppFixture: {
  (path: '/runtime', body: unknown): Promise<RuntimeApiResponse>;
  (path: '/state' | '/action', body?: unknown): Promise<RuntimePluginUiDataResult>;
};

const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
let notify: (() => Promise<void>) | undefined;
Object.assign(window, { reactApp: {
  notify: () => notify?.(),
  unmount() { flushSync(() => root.render(null)); },
  async mount(source: RuntimeSandboxedUiSource) {
    let data = (await requestReactAppFixture('/state')).data;
    const render = () => root.render(<SandboxedUiFrame title="Notes" source={source} storageKey="react-notes/notes.page"
      data={data} context={{pluginId:'react-notes', contributionId:'notes.page'}} allowedActionIds={['notes.save']}
      onAction={async (actionId, payload) => { data = (await requestReactAppFixture('/action', { actionId, payload })).data; render(); }}
      onRuntimeRequest={input => requestReactAppFixture('/runtime', input)} />);
    notify = async () => { data = (await requestReactAppFixture('/state')).data; render(); };
    render();
  },
} });
