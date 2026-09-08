import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { ComponentType } from 'react';
import type { SandboxedUiFrameProps } from '../contracts/index.js';

export interface UiCardRendererHost {
  readonly SandboxedUiFrame: ComponentType<SandboxedUiFrameProps>;
}

export const uiCardRendererHostCapability: CapabilityToken<UiCardRendererHost> = defineCapability({
  id: 'ui-card.renderer-host',
  description: 'Desktop-owned opaque iframe host for sandboxed Plugin UI',
});
