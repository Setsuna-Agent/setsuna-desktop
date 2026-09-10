/** Floating coordinates are viewport pixels; cancel body zoom at the portal root,
 * then scale the control inside the positioning wrapper to preserve UI density. */
export function overlayContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  let root = document.getElementById('setsuna-ui-overlays');
  if (!root) {
    root = document.createElement('div');
    root.id = 'setsuna-ui-overlays';
    document.body.append(root);
  }
  return root;
}

export type Placement = 'top' | 'topLeft' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomRight' | 'left' | 'leftTop' | 'leftBottom' | 'right' | 'rightTop' | 'rightBottom';
export function floatingPlacement(placement: Placement = 'bottomLeft') {
  const side = placement.replace(/Left|Right|Top|Bottom/g, '') as 'top' | 'bottom' | 'left' | 'right';
  const align = /Left|Top/.test(placement) ? 'start' : /Right|Bottom/.test(placement) ? 'end' : 'center';
  return { side, align } as const;
}
