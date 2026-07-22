import { describe, expect, it } from 'vitest';
import { selectMenuPosition } from '../../../../src/shared/ui/SelectField.js';

describe('SelectField menu positioning', () => {
  it('positions the menu below its trigger at the default page scale', () => {
    expect(selectMenuPosition(
      { bottom: 132, left: 240, top: 100, width: 220 },
      4,
      { height: 720, width: 1280 },
    )).toEqual({ left: 240, maxHeight: 280, top: 138, width: 220 });
  });

  it('converts visual coordinates back to the app coordinates when zoomed to 80%', () => {
    expect(selectMenuPosition(
      { bottom: 105.6, left: 192, top: 80, width: 176 },
      4,
      { height: 576, scaleInverse: 1.25, width: 1280 },
    )).toEqual({ left: 240, maxHeight: 280, top: 138, width: 220 });
  });

  it('opens above the trigger when the scaled viewport has insufficient room below', () => {
    expect(selectMenuPosition(
      { bottom: 700, left: 1200, top: 668, width: 220 },
      8,
      { height: 720, width: 1280 },
    )).toEqual({ left: 1052, maxHeight: 280, top: 382, width: 220 });
  });
});
