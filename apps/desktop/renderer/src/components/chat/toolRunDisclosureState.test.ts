import { describe, expect, it } from 'vitest';
import {
  hasExpandedToolRunDisclosure,
  resolveToolRunDisclosureOpen,
  updateToolRunDisclosurePreference,
  type ToolRunDisclosurePreferences,
} from './toolRunDisclosureState.js';

describe('tool run disclosure state', () => {
  it('keeps an explicit user choice across changing runtime defaults', () => {
    expect(resolveToolRunDisclosureOpen({ defaultOpen: false, preference: { anchorRunId: 'run_1', open: true } })).toBe(true);
    expect(resolveToolRunDisclosureOpen({ defaultOpen: true, preference: { anchorRunId: 'run_1', open: false } })).toBe(false);
  });

  it('opens a new ancestor when a manually expanded child is regrouped beneath it', () => {
    expect(resolveToolRunDisclosureOpen({ defaultOpen: false, descendantExpanded: true })).toBe(true);
    expect(resolveToolRunDisclosureOpen({
      defaultOpen: false,
      descendantExpanded: true,
      preference: { anchorRunId: 'run_1', open: false },
    })).toBe(false);
  });

  it('tracks expansion by the stable run anchor while groups grow during streaming', () => {
    let preferences: ToolRunDisclosurePreferences = new Map();
    preferences = updateToolRunDisclosurePreference(preferences, 'run:run_1', 'run_1', true);

    expect(hasExpandedToolRunDisclosure(preferences, ['run_1', 'run_2'])).toBe(true);
    expect(hasExpandedToolRunDisclosure(preferences, ['run_2'])).toBe(false);
  });
});
