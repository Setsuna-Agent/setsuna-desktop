import type {
  RuntimeApiRequest,
  RuntimeApiResponse,
  RuntimePluginUiData,
  RuntimeSandboxedUiSource,
} from '@setsuna-desktop/contracts';

export type SandboxedUiFrameProps = Readonly<{
  source: RuntimeSandboxedUiSource;
  data?: RuntimePluginUiData;
  context?: RuntimePluginUiData;
  title: string;
  className?: string;
  size?: 'content' | 'fill';
  /** Trusted library source supplied by the host, separate from bounded Plugin source. */
  libraryScripts?: readonly string[];
  allowedActionIds?: readonly string[];
  onAction?(actionId: string, payload: RuntimePluginUiData): Promise<void>;
  /** Only installed, trusted application pages receive this host callback. */
  onRuntimeRequest?(input: RuntimeApiRequest, signal: AbortSignal): Promise<RuntimeApiResponse>;
}>;
