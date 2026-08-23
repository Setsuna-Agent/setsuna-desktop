import type { RuntimeCodec } from './codec.js';
import type { FeatureId } from './definition.js';

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** The process-neutral shape shared by Core and Feature thread records. */
export type SequencedThreadEventRecord = Readonly<{
  id: string;
  seq: number;
  threadId: string;
  turnId?: string;
  type: string;
  createdAt: string;
  payload: unknown;
}>;

export type FeatureEventEnvelope<TPayload = unknown> = Readonly<{
  id: string;
  seq: number;
  threadId: string;
  turnId?: string;
  type: 'feature.event';
  createdAt: string;
  featureId: FeatureId;
  eventType: string;
  schemaVersion: number;
  payload: TPayload;
}>;

export type PendingFeatureEventEnvelope<TPayload = unknown> = Omit<
  FeatureEventEnvelope<TPayload>,
  'seq'
>;

export type FeatureEventFeedItem =
  | Readonly<{ kind: 'advance'; seq: number }>
  | Readonly<{ kind: 'event'; seq: number; event: FeatureEventEnvelope }>;

export type FeatureEventContract<TValue> = Readonly<{
  featureId: FeatureId;
  eventType: string;
  currentVersion: number;
  codecs: Readonly<Record<number, RuntimeCodec<unknown>>>;
  migrate(version: number, value: unknown): TValue;
}>;

export type DefineFeatureEventContractInput<TValue> = FeatureEventContract<TValue>;

export class FeatureEventDecodeError extends Error {
  readonly featureId: FeatureId;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly seq: number;

  constructor(
    envelope: Pick<FeatureEventEnvelope, 'featureId' | 'eventType' | 'schemaVersion' | 'seq'>,
    reason: string,
    options: ErrorOptions = {},
  ) {
    super(
      `Unable to decode Feature event ${envelope.featureId}/${envelope.eventType}`
      + `@${envelope.schemaVersion} at seq ${envelope.seq}: ${reason}`,
      options,
    );
    this.name = 'FeatureEventDecodeError';
    this.featureId = envelope.featureId;
    this.eventType = envelope.eventType;
    this.schemaVersion = envelope.schemaVersion;
    this.seq = envelope.seq;
  }
}

export function defineFeatureEventContract<TValue>(
  input: DefineFeatureEventContractInput<TValue>,
): FeatureEventContract<TValue> {
  if (!EVENT_TYPE_PATTERN.test(input.eventType)) {
    throw new Error(`Invalid Feature event type "${input.eventType}".`);
  }
  if (!Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1) {
    throw new Error(`Feature event "${input.eventType}" must use a positive currentVersion.`);
  }
  const codecs = Object.freeze({ ...input.codecs });
  for (let version = 1; version <= input.currentVersion; version += 1) {
    if (!codecs[version]) {
      throw new Error(`Feature event "${input.eventType}" is missing codec version ${version}.`);
    }
  }
  return Object.freeze({ ...input, codecs });
}

export function createFeatureEvent<TValue>(
  contract: FeatureEventContract<TValue>,
  metadata: Readonly<{
    id: string;
    threadId: string;
    turnId?: string;
    createdAt: string;
  }>,
  value: TValue,
): PendingFeatureEventEnvelope<TValue> {
  // Parse the write through the current codec too, so the event log never
  // receives a payload that the same package cannot replay after restart.
  const payload = contract.codecs[contract.currentVersion]!.parse(value) as TValue;
  return Object.freeze({
    ...metadata,
    type: 'feature.event' as const,
    featureId: contract.featureId,
    eventType: contract.eventType,
    schemaVersion: contract.currentVersion,
    payload,
  });
}

export function isFeatureEventEnvelope(
  record: SequencedThreadEventRecord,
): record is FeatureEventEnvelope {
  return record.type === 'feature.event'
    && typeof (record as Partial<FeatureEventEnvelope>).featureId === 'string'
    && typeof (record as Partial<FeatureEventEnvelope>).eventType === 'string'
    && Number.isSafeInteger((record as Partial<FeatureEventEnvelope>).schemaVersion);
}

export function parseFeatureEvent<TValue>(
  contract: FeatureEventContract<TValue>,
  envelope: FeatureEventEnvelope,
): TValue {
  if (envelope.featureId !== contract.featureId || envelope.eventType !== contract.eventType) {
    throw new FeatureEventDecodeError(envelope, 'contract identity does not match the envelope');
  }
  const codec = contract.codecs[envelope.schemaVersion];
  if (!codec || envelope.schemaVersion > contract.currentVersion) {
    throw new FeatureEventDecodeError(envelope, 'schema version is not supported');
  }
  try {
    return contract.migrate(envelope.schemaVersion, codec.parse(envelope.payload));
  } catch (error) {
    throw new FeatureEventDecodeError(envelope, 'payload or migration is invalid', { cause: error });
  }
}

type EventReducer<TState, TValue> = (
  state: TState,
  value: TValue,
  record: SequencedThreadEventRecord,
) => TState;

type RegisteredFeatureReducer<TState> = Readonly<{
  contract: FeatureEventContract<unknown>;
  reduce: EventReducer<TState, unknown>;
}>;

type RegisteredLegacyReducer<TState> = Readonly<{
  decode(record: SequencedThreadEventRecord): unknown;
  reduce: EventReducer<TState, unknown>;
}>;

/** A process-local contract and reducer table owned by one Feature. */
export class FeatureEventRegistry<TState> {
  private readonly reducers = new Map<string, RegisteredFeatureReducer<TState>>();
  private readonly legacyReducers = new Map<string, RegisteredLegacyReducer<TState>>();

  constructor(readonly featureId: FeatureId) {}

  register<TValue>(
    contract: FeatureEventContract<TValue>,
    reduce: EventReducer<TState, TValue>,
  ): Readonly<{ dispose(): void }> {
    if (contract.featureId !== this.featureId) {
      throw new Error(`Feature event ${contract.eventType} belongs to a different Feature.`);
    }
    if (this.reducers.has(contract.eventType)) {
      throw new Error(`Feature event reducer conflict for ${this.featureId}/${contract.eventType}.`);
    }
    const registration: RegisteredFeatureReducer<TState> = Object.freeze({
      contract: contract as FeatureEventContract<unknown>,
      reduce: reduce as EventReducer<TState, unknown>,
    });
    this.reducers.set(contract.eventType, registration);
    return disposableMapEntry(this.reducers, contract.eventType, registration);
  }

  /** Read-only compatibility for an event type that new code can no longer write. */
  registerLegacy<TValue>(
    eventType: string,
    decode: (record: SequencedThreadEventRecord) => TValue,
    reduce: EventReducer<TState, TValue>,
  ): Readonly<{ dispose(): void }> {
    if (eventType === 'feature.event' || this.legacyReducers.has(eventType)) {
      throw new Error(`Legacy Feature event reducer conflict for ${eventType}.`);
    }
    const registration: RegisteredLegacyReducer<TState> = Object.freeze({
      decode: decode as (record: SequencedThreadEventRecord) => unknown,
      reduce: reduce as EventReducer<TState, unknown>,
    });
    this.legacyReducers.set(eventType, registration);
    return disposableMapEntry(this.legacyReducers, eventType, registration);
  }

  reduce(state: TState, record: SequencedThreadEventRecord): TState {
    if (isFeatureEventEnvelope(record)) {
      if (record.featureId !== this.featureId) return state;
      const registration = this.reducers.get(record.eventType);
      if (!registration) {
        throw new FeatureEventDecodeError(record, 'event type is not registered');
      }
      const value = parseFeatureEvent(registration.contract, record);
      return registration.reduce(state, value, record);
    }
    const legacy = this.legacyReducers.get(record.type);
    return legacy ? legacy.reduce(state, legacy.decode(record), record) : state;
  }
}

function disposableMapEntry<TValue>(
  map: Map<string, TValue>,
  key: string,
  value: TValue,
): Readonly<{ dispose(): void }> {
  let disposed = false;
  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (map.get(key) === value) map.delete(key);
    },
  });
}
