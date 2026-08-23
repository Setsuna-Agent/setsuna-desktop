const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

declare const capabilityValueBrand: unique symbol;

export type CapabilityToken<TValue> = Readonly<{
  id: string;
  major: number;
  description: string;
  readonly [capabilityValueBrand]?: TValue;
}>;

export type CapabilityDeclaration<TValue = unknown> = Readonly<{
  token: CapabilityToken<TValue>;
}>;

export type CapabilityRequirement<TValue = unknown> = Readonly<{
  token: CapabilityToken<TValue>;
  kind: 'required' | 'optional';
  fallback?: () => TValue;
}>;

export type DependencySpec = Readonly<Record<string, CapabilityRequirement>>;

export type ResolveDependencies<TSpec extends DependencySpec> = Readonly<{
  [TKey in keyof TSpec]: TSpec[TKey] extends CapabilityRequirement<infer TValue>
    ? TValue
    : never;
}>;

export type CapabilityRequirementDeclaration = Readonly<{
  slot: string;
  token: CapabilityToken<unknown>;
  kind: 'required' | 'optional';
  fallback?: () => unknown;
}>;

export type HostCapabilityProvider<TValue = unknown> = Readonly<{
  declaration: CapabilityDeclaration<TValue>;
  value: TValue;
}>;

export function defineCapability<TValue>(input: Readonly<{
  id: string;
  major: number;
  description: string;
}>): CapabilityToken<TValue> {
  if (!CAPABILITY_ID_PATTERN.test(input.id)) {
    throw new Error(`Invalid Capability id "${input.id}". Expected a dotted lowercase namespace.`);
  }
  if (!Number.isSafeInteger(input.major) || input.major < 1) {
    throw new Error(`Capability "${input.id}" must declare a positive integer major version.`);
  }
  if (!input.description.trim()) {
    throw new Error(`Capability "${input.id}" must include a description.`);
  }
  return Object.freeze({ ...input }) as CapabilityToken<TValue>;
}

export function declareCapabilityProvider<TValue>(
  token: CapabilityToken<TValue>,
): CapabilityDeclaration<TValue> {
  return Object.freeze({ token });
}

export function requiredCapability<TValue>(
  token: CapabilityToken<TValue>,
): CapabilityRequirement<TValue> {
  return Object.freeze({ token, kind: 'required' as const });
}

export function optionalCapability<TValue>(
  token: CapabilityToken<TValue>,
  fallback: () => TValue,
): CapabilityRequirement<TValue> {
  return Object.freeze({ token, kind: 'optional' as const, fallback });
}

export function provideHostCapability<TValue>(
  declaration: CapabilityDeclaration<TValue>,
  value: TValue,
): HostCapabilityProvider<TValue> {
  return Object.freeze({ declaration, value });
}

export function capabilityKey(token: CapabilityToken<unknown>): string {
  return `${token.id}@${token.major}`;
}

export function eraseDependencySpec(spec: DependencySpec): readonly CapabilityRequirementDeclaration[] {
  return Object.freeze(Object.entries(spec).map(([slot, requirement]) => Object.freeze({
    slot,
    token: requirement.token,
    kind: requirement.kind,
    ...(requirement.fallback ? { fallback: requirement.fallback } : {}),
  })));
}
