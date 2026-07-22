import { describe, expect, it } from 'vitest';
import { zoomedPortalPosition } from '../../../../src/shared/lib/zoomedPortalPosition.js';

describe('zoomedPortalPosition', () => {
  it('uses visual coordinates directly at the default page scale', () => {
    expect(zoomedPortalPosition({
      anchorX: 600,
      anchorY: 300,
      menuHeight: 96,
      menuWidth: 208,
      viewportHeight: 900,
      viewportWidth: 1440,
    })).toEqual({ left: 600, top: 300 });
  });

  it('converts pointer coordinates into the app coordinate space at 120% zoom', () => {
    expect(zoomedPortalPosition({
      anchorX: 720,
      anchorY: 450,
      menuHeight: 96,
      menuWidth: 208,
      scaleInverse: 1 / 1.2,
      viewportHeight: 900,
      viewportWidth: 1440,
    })).toEqual({ left: 600, top: 375 });
  });

  it('aligns trigger menus and keeps them inside the scaled viewport', () => {
    expect(zoomedPortalPosition({
      anchorX: 1440,
      anchorY: 890,
      horizontalAlign: 'end',
      menuHeight: 80,
      menuWidth: 138,
      offsetY: 6,
      scaleInverse: 1 / 1.2,
      viewportHeight: 900,
      viewportWidth: 1440,
    })).toEqual({ left: 1054, top: 662 });
  });
});
