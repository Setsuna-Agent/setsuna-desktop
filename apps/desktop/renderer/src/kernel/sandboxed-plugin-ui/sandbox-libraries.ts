import type { RuntimePluginUiLibrary } from '@setsuna-desktop/contracts';

/** Load source as text: third-party libraries execute only inside the isolated frame. */
export async function loadSandboxedUiLibraries(
  libraries: readonly RuntimePluginUiLibrary[] = [],
): Promise<readonly string[]> {
  return Promise.all(libraries.map(async (library) => {
    switch (library) {
      case 'echarts':
        return (await import('echarts/dist/echarts.min.js?raw')).default;
      default:
        throw new Error(`Unsupported Plugin UI library: ${String(library)}`);
    }
  }));
}
