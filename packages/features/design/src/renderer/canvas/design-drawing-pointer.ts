export function trackDesignDrawingPointer(view: Window, pointerId: number, signal: AbortSignal, { move, finish, cancel }: Readonly<{
  move(event: PointerEvent): void;
  finish(release?: PointerEvent): void;
  cancel(): void;
}>) {
  // Capture can move between elements. Observe release even when its target leaves the drawing surface.
  const events = { capture: true, signal };
  view.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && !(event.buttons & 1)) {
      // A hover after a release outside the window must not extend the drawing.
      finish();
    } else move(event);
  }, { ...events, passive: true });
  view.addEventListener('pointerup', (event) => { if (event.pointerId === pointerId) finish(event); }, events);
  view.addEventListener('pointercancel', (event) => { if (event.pointerId === pointerId) cancel(); }, events);
  view.addEventListener('blur', cancel, { signal });
}
