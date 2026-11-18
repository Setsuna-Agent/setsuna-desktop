const { window: testWindow } = globalThis as { window?: { happyDOM?: unknown; Element: { prototype: object } } };
if (testWindow?.happyDOM) {
  // Use the JS animation path in happy-dom, whose WAAPI cancellation rejects eagerly.
  Reflect.deleteProperty(testWindow.Element.prototype, 'animate');
}
