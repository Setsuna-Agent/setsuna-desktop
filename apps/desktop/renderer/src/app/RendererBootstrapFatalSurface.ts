type FatalSurfaceCopy = Readonly<{
  description: string;
  reload: string;
  title: string;
}>;

const COPY: Readonly<Record<'en-US' | 'zh-CN', FatalSurfaceCopy>> = Object.freeze({
  'en-US': Object.freeze({
    description: 'The renderer could not initialize, so Setsuna did not load a partial interface.',
    reload: 'Reload',
    title: 'Interface failed to start',
  }),
  'zh-CN': Object.freeze({
    description: 'Renderer 初始化失败，Setsuna 没有加载不完整的界面。',
    reload: '重新加载',
    title: '界面启动失败',
  }),
});

/**
 * Last-resort recovery for failures that happen before the React tree exists.
 * Keep this surface independent from Feature composition and Renderer Plugins.
 */
export function renderRendererBootstrapFatalSurface(error: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;

  const copy = COPY[document.documentElement.lang === 'en-US' ? 'en-US' : 'zh-CN'];
  const surface = document.createElement('main');
  surface.className = 'app-bootstrap-fatal';
  surface.setAttribute('role', 'alert');

  const panel = document.createElement('section');
  panel.className = 'app-bootstrap-fatal__panel';

  const product = document.createElement('span');
  product.className = 'app-bootstrap-fatal__product';
  product.textContent = 'Setsuna Desktop';

  const title = document.createElement('h1');
  title.textContent = copy.title;

  const description = document.createElement('p');
  description.textContent = copy.description;

  const detail = document.createElement('pre');
  detail.className = 'app-bootstrap-fatal__detail';
  detail.textContent = errorMessage(error);

  const reload = document.createElement('button');
  reload.className = 'app-bootstrap-fatal__reload';
  reload.type = 'button';
  reload.textContent = copy.reload;
  reload.addEventListener('click', () => window.location.reload());

  panel.append(product, title, description, detail, reload);
  surface.append(panel);
  root.replaceChildren(surface);
  reload.focus();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const message = String(error).trim();
  return message || 'Unknown renderer bootstrap error';
}
