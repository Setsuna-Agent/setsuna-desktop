export type SseFrame = { event: string; data: string };

/** Scan each incoming character once. Retaining pieces avoids quadratic copying of large JSON frames. */
export class RuntimeSseParser {
  private lineParts: string[] = [];
  private data: string[] = [];
  private event = '';
  private afterCarriageReturn = false;

  push(chunk: string): SseFrame[] {
    const frames: SseFrame[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const code = chunk.charCodeAt(index);
      if (this.afterCarriageReturn) {
        this.afterCarriageReturn = false;
        if (code === 10) { start = index + 1; continue; }
      }
      if (code !== 10 && code !== 13) continue;
      this.lineParts.push(chunk.slice(start, index));
      this.acceptLine(this.lineParts.join(''), frames);
      this.lineParts = [];
      this.afterCarriageReturn = code === 13;
      start = index + 1;
    }
    if (start < chunk.length) this.lineParts.push(chunk.slice(start));
    return frames;
  }

  private acceptLine(line: string, frames: SseFrame[]): void {
    if (!line) {
      if (this.data.length) frames.push({ event: this.event, data: this.data.join('\n') });
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? '' : line.slice(separator + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') this.event = value;
    if (field === 'data') this.data.push(value);
  }
}
