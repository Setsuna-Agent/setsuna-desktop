export interface RuntimeCodec<TValue> {
  parse(value: unknown): TValue;
}

export function defineRuntimeCodec<TValue>(parse: (value: unknown) => TValue): RuntimeCodec<TValue> {
  return Object.freeze({ parse });
}
