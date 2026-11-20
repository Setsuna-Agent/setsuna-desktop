import type { DesignScriptSource } from './design-script-source.js';

// Keep the source self-contained so each copy can be edited in the project.
export const designScriptPresets: readonly (DesignScriptSource & { label: `feature.design.scriptPreset.${string}` })[] = [
  {
    name: 'line-chart.js',
    label: 'feature.design.scriptPreset.lineChart',
    source: `/**
 * @input series1: string = "24,32,29,48,42,64,57,75"
 * @input series2: string = "12,16,23,20,35,31,45,50"
 * @input label1: string = "Series A"
 * @input label2: string = "Series B"
 * @input color1: color = #2563EB
 * @input color2: color = #0F766E
 * @input stroke: number = 2.5
 */
const { width, height, input } = canvas;
function values(text) {
  return text.split(',').map((part) => part.trim()).filter(Boolean).map(Number).filter(Number.isFinite).slice(0, 128);
}
const series = [
  { name: input.label1, color: input.color1, values: values(input.series1) },
  { name: input.label2, color: input.color2, values: values(input.series2) },
];

const inset = Math.min(20, width * 0.08, height * 0.1);
const plot = { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
const maximum = Math.max(1, ...series.flatMap(({ values }) => values)) * 1.1;
const intervals = Math.max(1, ...series.map(({ values }) => values.length - 1));
const layers = Array.from({ length: 5 }, (_, index) => ({
  kind: 'rectangle', name: 'Grid line', x: plot.x, y: plot.y + plot.height * index / 4,
  width: plot.width, height: Math.min(1, inset / 4), cornerRadius: 0,
  fills: [{ color: '#94A3B8', opacity: 0.35 }],
}));

for (const { name, color, values } of series) {
  if (values.length < 2) continue;
  const anchors = values.map((value, index) => ({ x: index / intervals, y: 1 - Math.max(0, value) / maximum }));
  layers.push({
    kind: 'vector', name, ...plot,
    geometry: { kind: 'path', closed: false, anchors },
    strokes: [{ color, width: Math.min(Math.max(0.01, input.stroke), inset / 2), join: 'round' }],
  });
}
return layers;
`,
  },
  {
    name: 'bar-chart.js',
    label: 'feature.design.scriptPreset.barChart',
    source: `/**
 * @input values: string = "32,48,41,66,57,77,68"
 * @input labels: string = "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
 * @input color: color = #2563EB
 */
const { width, height, input } = canvas;
const labels = input.labels.split(',');
const data = input.values.split(',').slice(0, 64).map((part, index) => {
  const value = Number(part.trim());
  return { label: labels[index]?.trim() || String(index + 1), value: Number.isFinite(value) ? value : 0 };
});
const inset = Math.min(20, width * 0.08, height * 0.1);
const slotWidth = (width - inset * 2) / Math.max(1, data.length);
const fontSize = Math.min(12, slotWidth / 3, height / 8);
const plotHeight = height - inset * 2 - fontSize * 1.8;
const baseline = inset + plotHeight;
const maximum = Math.max(1, ...data.map(({ value }) => value)) * 1.1;
const barWidth = slotWidth * 0.64;

return data.flatMap(({ label, value }, index) => {
  const x = inset + index * slotWidth;
  const caption = {
    kind: 'text', text: label, x, y: baseline + fontSize * 0.4, width: slotWidth,
    fontSize, textAlign: 'center', fills: [{ color: '#64748B' }],
  };
  if (value <= 0) return [caption];
  const barHeight = plotHeight * (value / maximum);
  return [{
    kind: 'rectangle', name: label, x: x + (slotWidth - barWidth) / 2, y: baseline - barHeight,
    width: barWidth, height: barHeight, cornerRadius: Math.min(4, barWidth / 4, barHeight / 2), fills: [{ color: input.color }],
  }, caption];
});
`,
  },
  {
    name: 'dot-grid.js',
    label: 'feature.design.scriptPreset.dotGrid',
    source: `/**
 * @input spacing: number = 20
 * @input size: number = 3
 * @input color: color = #64748B
 */
const { width, height, input } = canvas;
const spacing = Math.max(1, input.spacing);
// Cap each axis so the grid fits the script layer limit at any canvas size.
const columns = Math.max(1, Math.min(20, Math.floor(width / spacing)));
const rows = Math.max(1, Math.min(20, Math.floor(height / spacing)));
const cellWidth = width / columns;
const cellHeight = height / rows;
const diameter = Math.min(Math.max(0.01, input.size), cellWidth / 4, cellHeight / 4);

return Array.from({ length: rows * columns }, (_, index) => ({
  kind: 'ellipse',
  x: (index % columns + 0.5) * cellWidth - diameter / 2,
  y: (Math.floor(index / columns) + 0.5) * cellHeight - diameter / 2,
  width: diameter, height: diameter, fills: [{ color: input.color, opacity: 0.55 }],
}));
`,
  },
];
