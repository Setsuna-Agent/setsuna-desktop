import type {
  RuntimePluginUiData,
  RuntimeSandboxedUiSource,
} from '@setsuna-desktop/contracts';

export type SandboxedUiFrameProps = Readonly<{
  source: RuntimeSandboxedUiSource;
  data?: RuntimePluginUiData;
  context?: RuntimePluginUiData;
  title: string;
  className?: string;
  allowedActionIds?: readonly string[];
  onAction?(actionId: string, payload: RuntimePluginUiData): Promise<void>;
}>;
