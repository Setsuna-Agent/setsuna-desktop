import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  appServerConfigFeatureEnablement,
  sweExperimentalFeatureListResponse,
  sweFeatureEnablementRuntimeInput,
  sweSupportedFeatureEnablement,
} from '../../../src/server/app-server/feature-protocol.js';

describe('app-server feature protocol', () => {
  it('owns the config/read feature defaults and applies explicit overrides', () => {
    expect(appServerConfigFeatureEnablement(featureConfig({
      memories: true,
      mentions_v2: false,
    }))).toEqual({
      auth_elicitation: false,
      default_mode_request_user_input: true,
      hooks: true,
      memories: true,
      mentions_v2: false,
      plugins: true,
      remote_control: false,
      remote_plugin: false,
    });
  });

  it('filters enablement writes and preserves unrelated runtime feature flags', () => {
    const config = featureConfig({ existing: true, memories: true });
    const enablement = sweSupportedFeatureEnablement({
      memories: false,
      mentions_v2: false,
      plugins: 'yes',
      unsupported: true,
    });

    expect(enablement).toEqual({
      memories: false,
      mentions_v2: false,
    });
    expect(sweFeatureEnablementRuntimeInput(config, enablement)).toEqual({
      features: {
        existing: true,
        memories: false,
        mentions_v2: false,
      },
    });
  });

  it('keeps catalog ordering, forced-disable policy, and offset cursor validation together', () => {
    const config = featureConfig({ apps: true, memories: true });
    expect(sweExperimentalFeatureListResponse(config, { limit: 2 })).toEqual({
      data: [
        expect.objectContaining({ name: 'undo', enabled: false, defaultEnabled: false }),
        expect.objectContaining({ name: 'shell_tool', enabled: true, defaultEnabled: true }),
      ],
      nextCursor: '2',
    });

    const catalog = sweExperimentalFeatureListResponse(config, {});
    expect(catalog.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memories', enabled: true }),
      expect.objectContaining({ name: 'apps', enabled: false, defaultEnabled: true }),
    ]));
    expect(() => sweExperimentalFeatureListResponse(config, { cursor: 'invalid' }))
      .toThrow('invalid cursor: invalid');
    expect(() => sweExperimentalFeatureListResponse(config, { cursor: '9999' }))
      .toThrow(/cursor 9999 exceeds total feature flags \d+/u);
  });
});

function featureConfig(features: Record<string, boolean>): RuntimeConfigState {
  return { features } as RuntimeConfigState;
}
