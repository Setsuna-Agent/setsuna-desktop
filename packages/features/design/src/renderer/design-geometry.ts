export type Point = Readonly<{ x: number; y: number }>;
export type Bounds = Point & Readonly<{ width: number; height: number }>;
type DesignOrientation = Readonly<{ rotation?: number; flipX?: boolean; flipY?: boolean }>;
export type DesignTransform = Readonly<{ absoluteX: number; absoluteY: number; angle: number; scaleX: number; scaleY: number }>;

export function rotatePoint(point: Point, degrees: number): Point {
  if (!degrees) return point;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function toWorld(transform: DesignTransform | undefined, point: Point): Point {
  if (!transform) return point;
  const rotated = toWorldVector(transform, point);
  return { x: transform.absoluteX + rotated.x, y: transform.absoluteY + rotated.y };
}

export function toLocal(transform: DesignTransform | undefined, point: Point): Point {
  if (!transform) return point;
  return toLocalVector(transform, { x: point.x - transform.absoluteX, y: point.y - transform.absoluteY });
}

export function toWorldVector(transform: DesignTransform | undefined, point: Point): Point {
  return transform ? rotatePoint({ x: point.x * transform.scaleX, y: point.y * transform.scaleY }, transform.angle) : point;
}

export function toLocalVector(transform: DesignTransform | undefined, point: Point): Point {
  if (!transform) return point;
  const rotated = rotatePoint(point, -transform.angle);
  return { x: rotated.x * transform.scaleX, y: rotated.y * transform.scaleY };
}

export function directionOfRotation(transform: DesignTransform | undefined): number {
  return transform ? transform.scaleX * transform.scaleY : 1;
}

export function layerTransform(bounds: Bounds, orientation: DesignOrientation, parent?: DesignTransform): DesignTransform {
  const rotation = orientation.rotation ?? 0;
  const scaleX = orientation.flipX ? -1 : 1;
  const scaleY = orientation.flipY ? -1 : 1;
  const pivot = { x: bounds.width / 2, y: bounds.height / 2 };
  const corner = rotatePoint({ x: pivot.x * scaleX, y: pivot.y * scaleY }, rotation);
  const world = toWorld(parent, { x: bounds.x + pivot.x - corner.x, y: bounds.y + pivot.y - corner.y });
  // A reflection reverses the angle of the child before the parent's rotation is applied.
  return {
    absoluteX: world.x, absoluteY: world.y, angle: (parent?.angle ?? 0) + directionOfRotation(parent) * rotation,
    scaleX: scaleX * (parent?.scaleX ?? 1), scaleY: scaleY * (parent?.scaleY ?? 1),
  };
}

export function orientationInParent(transform: DesignTransform, parent?: DesignTransform): DesignOrientation {
  return {
    rotation: roundDesignValue((transform.angle - (parent?.angle ?? 0)) * directionOfRotation(parent)),
    flipX: transform.scaleX !== (parent?.scaleX ?? 1) || undefined,
    flipY: transform.scaleY !== (parent?.scaleY ?? 1) || undefined,
  };
}

export function unreflect(width: number, height: number, { scaleX, scaleY }: Pick<DesignTransform, 'scaleX' | 'scaleY'>) {
  return { x: scaleX < 0 ? width : 0, y: scaleY < 0 ? height : 0, scaleX, scaleY };
}

export function transformedBounds(box: DesignTransform & Readonly<{ width: number; height: number }>): Bounds {
  if (!box.angle) return { x: box.absoluteX - (box.scaleX < 0 ? box.width : 0),
    y: box.absoluteY - (box.scaleY < 0 ? box.height : 0), width: box.width, height: box.height };
  const corners = [
    toWorld(box, { x: 0, y: 0 }), toWorld(box, { x: box.width, y: 0 }),
    toWorld(box, { x: 0, y: box.height }), toWorld(box, { x: box.width, y: box.height }),
  ];
  return unionBounds(corners.map((point) => ({ ...point, width: 0, height: 0 }))) as Bounds;
}

export function unionBounds(bounds: readonly Bounds[]): Bounds | undefined {
  if (!bounds.length) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of bounds) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function containsBounds(outer: Bounds, inner: Bounds) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function boundsBetween(a: Point, b: Point): Bounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function roundDesignValue(value: number) {
  return Math.round(value * 100) / 100;
}
