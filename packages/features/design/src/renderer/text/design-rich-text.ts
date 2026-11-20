import { Util } from 'konva/lib/Util.js';
import type { DesignText, DesignTextRun } from '../../contracts/index.js';
import { designFontStyleWeight, designTextStyle } from './design-typography.js';

export function designTextSegments(text: string, runs: readonly DesignTextRun[] = []) {
  const segments: { text: string; run?: DesignTextRun }[] = [];
  let offset = 0;
  for (const run of runs) {
    if (offset < run.start) segments.push({ text: text.slice(offset, run.start) });
    segments.push({ text: text.slice(run.start, run.end), run });
    offset = run.end;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset) });
  return segments;
}

type TextStyle = ReturnType<typeof designTextStyle>;
type Piece = { text: string; style: TextStyle; width: number; color?: string };
type Line = { pieces: Piece[]; width: number; height: number; ended: boolean };
let context: CanvasRenderingContext2D | undefined;
let graphemes: Intl.Segmenter | undefined;

export function layoutRichDesignText(node: DesignText, maxWidth?: number) {
  const base = designTextStyle(node);
  const capacity = maxWidth ?? Infinity;
  const lines: Line[] = [];
  let line: Line = newLine();
  const measure = context ??= Util.createCanvasElement().getContext('2d') ?? undefined;
  const widths = new Map<string, number>();

  function newLine(): Line {
    return { pieces: [], width: 0, height: base.fontSize * base.lineHeight, ended: false };
  }
  function finish(ended = false) {
    lines.push({ ...line, ended });
    line = newLine();
  }
  function piece(text: string, style: TextStyle, color?: string): Piece {
    const font = `${designFontStyleWeight(style)} ${style.fontSize}px ${style.fontFamily}`;
    const key = JSON.stringify([font, style.letterSpacing, text]);
    let width = widths.get(key);
    if (width === undefined) {
      if (measure) measure.font = font;
      width = Math.max(0, (measure?.measureText(text).width ?? text.length * style.fontSize * 0.6) + text.length * style.letterSpacing);
      widths.set(key, width);
    }
    return { text, style, color, width };
  }
  function append(next: Piece) {
    line.pieces.push(next);
    line.width += next.width;
    line.height = Math.max(line.height, next.style.fontSize * next.style.lineHeight);
  }
  for (const segment of designTextSegments(node.text, node.runs)) {
    const run = segment.run;
    const style = run ? designTextStyle({ ...node, fontSize: run.fontSize ?? node.fontSize,
      fontFamily: run.fontFamily ?? node.fontFamily, fontWeight: run.fontWeight ?? node.fontWeight }) : base;
    for (const token of segment.text.match(/\r\n|[\r\n]|[^\S\r\n]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
      if (/^[\r\n]/u.test(token)) { finish(true); continue; }
      const next = piece(token, style, run?.color);
      if (next.width <= capacity) {
        if (line.pieces.length && line.width + next.width > capacity) finish();
        append(next);
        continue;
      }
      graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      let fragment = '';
      for (const { segment: character } of graphemes.segment(token)) {
        if ((line.pieces.length || fragment) && line.width + piece(fragment + character, style).width > capacity) {
          if (fragment) append(piece(fragment, style, run?.color));
          finish();
          fragment = '';
        }
        fragment += character;
      }
      if (fragment) append(piece(fragment, style, run?.color));
    }
  }
  finish(true);
  const widestLine = lines.reduce((widest, line) => Math.max(widest, line.width), 0);
  const width = Math.max(1, Math.min(capacity, Math.ceil(widestLine)));
  const targetWidth = maxWidth ?? width;
  let height = 0;
  const pieces = lines.flatMap((line) => {
    const spare = Math.max(0, targetWidth - line.width);
    const gaps = base.textAlign === 'justify' && !line.ended ? line.pieces.filter((piece) => /^\s+$/u.test(piece.text)).length : 0;
    let x = base.textAlign === 'right' ? spare : base.textAlign === 'center' ? spare / 2 : 0;
    const positioned = line.pieces.map((piece) => {
      const y = height + (line.height - piece.style.fontSize * piece.style.lineHeight) / 2;
      const result = { ...piece, x, y };
      x += piece.width + (gaps && /^\s+$/u.test(piece.text) ? spare / gaps : 0);
      return result;
    });
    height += line.height;
    return positioned;
  });
  return { width, height, pieces };
}
