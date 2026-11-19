// Color conversion adapted from beUI. See the MIT notice in color-picker.tsx.
export type Hsv = { h: number; s: number; v: number };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function hexToHsv(hex: string, previous?: Hsv): Hsv {
  const rgb = /^#[\da-f]{6}$/iu.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0;
  const red = (rgb >> 16) / 255;
  const green = (rgb >> 8 & 255) / 255;
  const blue = (rgb & 255) / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = previous?.h ?? 0;
  // An achromatic value can't carry hue. Keep it so the next drag off gray uses the chosen hue.
  if (delta) {
    if (max === red) hue = (green - blue) / delta;
    else if (max === green) hue = 2 + (blue - red) / delta;
    else hue = 4 + (red - green) / delta;
    hue = (hue * 60 + 360) % 360;
  }
  return { h: hue, s: max ? delta / max * 100 : (previous?.s ?? 0), v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const saturation = s / 100;
  const brightness = v / 100;
  const channel = (offset: number) => {
    const position = (offset + h / 60) % 6;
    const value = brightness - brightness * saturation * Math.max(0, Math.min(position, 4 - position, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
