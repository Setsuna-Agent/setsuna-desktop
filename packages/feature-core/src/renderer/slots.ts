import type { ReactNode } from 'react';
import type { Awaitable, Disposer } from '../scope.js';

declare const rendererSlotProps: unique symbol;
declare const rendererSlotKey: unique symbol;
declare const rendererSlotMetadata: unique symbol;
declare const rendererSlotInput: unique symbol;
declare const rendererSlotOutput: unique symbol;

export type RendererSlotKind = 'single' | 'list' | 'keyed' | 'chain';
export type RendererSlotScope = 'app' | 'project' | 'thread';

export type RendererPluginOwner = Readonly<{
  pluginId: string;
  featureId?: string;
  scopeId: string;
}>;

type RendererSlotDefinitionBase<TKind extends RendererSlotKind> = Readonly<{
  id: string;
  kind: TKind;
  scope: RendererSlotScope;
  userConfigurable: boolean;
}>;

export type RendererSingleSlot<TProps extends object> = RendererSlotDefinitionBase<'single'> & Readonly<{
  [rendererSlotProps]?: (props: TProps) => TProps;
}>;

export type RendererListSlot<TProps extends object> = RendererSlotDefinitionBase<'list'> & Readonly<{
  [rendererSlotProps]?: (props: TProps) => TProps;
}>;

export type RendererKeyedSlot<
  TKey extends string,
  TProps extends object,
  TMetadata = never,
> = RendererSlotDefinitionBase<'keyed'> & Readonly<{
  [rendererSlotKey]?: (key: TKey) => TKey;
  [rendererSlotMetadata]?: TMetadata;
  [rendererSlotProps]?: (props: TProps) => TProps;
}>;

export type RendererChainSlot<TInput, TOutput> = RendererSlotDefinitionBase<'chain'> & Readonly<{
  [rendererSlotInput]?: (input: TInput) => TInput;
  [rendererSlotOutput]?: (output: TOutput) => TOutput;
}>;

export type RendererVisualSlot<TProps extends object = object> =
  | RendererSingleSlot<TProps>
  | RendererListSlot<TProps>
  | RendererKeyedSlot<any, TProps, any>;

export type RendererAnySlot = RendererVisualSlot<any> | RendererChainSlot<any, any>;

export type RendererSlotProps<TSlot extends RendererVisualSlot<any>> =
  TSlot extends RendererVisualSlot<infer TProps> ? TProps : never;

export type RendererSlotKey<TSlot extends RendererKeyedSlot<any, any, any>> =
  TSlot extends RendererKeyedSlot<infer TKey, any, any> ? TKey : never;

export type RendererSlotMetadata<TSlot extends RendererKeyedSlot<any, any, any>> =
  TSlot extends RendererKeyedSlot<any, any, infer TMetadata> ? TMetadata : never;

export type RendererKeyedEntryDescriptor<TKey extends string, TMetadata> = Readonly<{
  entryId: string;
  key: TKey;
  metadata: TMetadata;
  owner: RendererPluginOwner;
}>;

export type RendererChainInput<TSlot extends RendererChainSlot<any, any>> =
  TSlot extends RendererChainSlot<infer TInput, any> ? TInput : never;

export type RendererChainOutput<TSlot extends RendererChainSlot<any, any>> =
  TSlot extends RendererChainSlot<any, infer TOutput> ? TOutput : never;

export interface RendererOwnedSlotRenderer {
  chain<TInput, TOutput>(slot: RendererChainSlot<TInput, TOutput>, input: TInput): TOutput;
  /**
   * `instanceKey` is required when an outlet crosses into a non-app scope.
   * Children in the same scope may inherit their parent's concrete instance.
   */
  single<TProps extends object>(
    slot: RendererSingleSlot<TProps>,
    props: TProps,
    instanceKey?: string,
  ): ReactNode;
  list<TProps extends object>(
    slot: RendererListSlot<TProps>,
    props: TProps,
    instanceKey?: string,
  ): ReactNode;
  keyed<TKey extends string, TProps extends object, TMetadata>(
    slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
    key: TKey,
    props: TProps,
    instanceKey?: string,
  ): ReactNode;
  keyedEntries<TKey extends string, TProps extends object, TMetadata>(
    slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
  ): readonly RendererKeyedEntryDescriptor<TKey, TMetadata>[];
}

export type RendererSlotRender<TProps extends object> = (
  props: TProps,
  slots: RendererOwnedSlotRenderer,
) => ReactNode;

export type RendererSlotErrorRender<TProps extends object> = (
  error: Error,
  props: TProps,
  reset: () => void,
) => ReactNode;

export type RendererVisualSlotFallback<TProps extends object> = Readonly<{
  render(props: TProps): ReactNode;
}>;

export type RendererChainSlotFallback<TInput, TOutput> = Readonly<{
  resolve(input: TInput): TOutput;
}>;

export type RendererSlotDeclaration<TSlot extends RendererAnySlot = RendererAnySlot> = Readonly<{
  slot: TSlot;
  required?: boolean;
  requiredKeys?: TSlot extends RendererKeyedSlot<infer TKey, any, any>
    ? readonly TKey[]
    : never;
  fallback?: TSlot extends RendererChainSlot<infer TInput, infer TOutput>
    ? RendererChainSlotFallback<TInput, TOutput>
    : TSlot extends RendererVisualSlot<infer TProps>
      ? RendererVisualSlotFallback<TProps>
      : never;
}>;

type RendererVisualEntryBase<TProps extends object> = Readonly<{
  id: string;
  children?: readonly RendererSlotDeclaration[];
  errorFallback?: RendererSlotErrorRender<TProps>;
  render: RendererSlotRender<TProps>;
}>;

export type RendererSingleSlotEntry<TProps extends object> = RendererVisualEntryBase<TProps> & Readonly<{
  priority?: number;
}>;

export type RendererListSlotEntry<TProps extends object> = RendererVisualEntryBase<TProps> & Readonly<{
  order: number;
  when?: (props: TProps) => boolean;
}>;

export type RendererKeyedSlotEntry<
  TKey extends string,
  TProps extends object,
  TMetadata = never,
> = RendererVisualEntryBase<TProps> & Readonly<{
  key: TKey;
  priority?: number;
}> & ([TMetadata] extends [never]
  ? Readonly<{ metadata?: never }>
  : Readonly<{ metadata: TMetadata }>);

export type RendererChainSlotEntry<TInput, TOutput> = Readonly<{
  id: string;
  priority?: number;
  select(input: TInput): TOutput | null;
}>;

export interface RendererUiRegistrar {
  readonly owner: RendererPluginOwner;
  single<TProps extends object>(
    slot: RendererSingleSlot<TProps>,
    entry: RendererSingleSlotEntry<TProps>,
  ): Disposer;
  list<TProps extends object>(
    slot: RendererListSlot<TProps>,
    entry: RendererListSlotEntry<TProps>,
  ): Disposer;
  keyed<TKey extends string, TProps extends object, TMetadata>(
    slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
    entry: RendererKeyedSlotEntry<TKey, TProps, TMetadata>,
  ): Disposer;
  chain<TInput, TOutput>(
    slot: RendererChainSlot<TInput, TOutput>,
    entry: RendererChainSlotEntry<TInput, TOutput>,
  ): Disposer;
}

export type RendererPluginDefinition = Readonly<{
  id: string;
  activate(context: Readonly<{ ui: RendererUiRegistrar }>): Awaitable<void>;
}>;

type DefineRendererSlotInput = Readonly<{
  id: string;
  scope: RendererSlotScope;
  userConfigurable?: boolean;
}>;

export function defineSingleRendererSlot<TProps extends object>(
  input: DefineRendererSlotInput,
): RendererSingleSlot<TProps> {
  return defineRendererSlot(input, 'single') as RendererSingleSlot<TProps>;
}

export function defineListRendererSlot<TProps extends object>(
  input: DefineRendererSlotInput,
): RendererListSlot<TProps> {
  return defineRendererSlot(input, 'list') as RendererListSlot<TProps>;
}

export function defineKeyedRendererSlot<TKey extends string, TProps extends object, TMetadata = never>(
  input: DefineRendererSlotInput,
): RendererKeyedSlot<TKey, TProps, TMetadata> {
  return defineRendererSlot(input, 'keyed') as RendererKeyedSlot<TKey, TProps, TMetadata>;
}

export function defineChainRendererSlot<TInput, TOutput>(
  input: DefineRendererSlotInput,
): RendererChainSlot<TInput, TOutput> {
  return defineRendererSlot(input, 'chain') as RendererChainSlot<TInput, TOutput>;
}

export function declareRendererChildSlot<TSlot extends RendererAnySlot>(
  slot: TSlot,
  options: Omit<RendererSlotDeclaration<TSlot>, 'slot'> = {},
): RendererSlotDeclaration<TSlot> {
  return Object.freeze({ slot, ...options }) as RendererSlotDeclaration<TSlot>;
}

export function defineRendererPlugin(
  definition: RendererPluginDefinition,
): RendererPluginDefinition {
  assertRendererPluginId(definition.id);
  return Object.freeze({ ...definition });
}

export function assertRendererPluginId(id: string): void {
  if (!/^(?:core|feature)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(id)) {
    throw new Error(`Invalid Renderer Plugin id: ${id}`);
  }
}

export function assertRendererSlotEntryId(id: string): void {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(id)) {
    throw new Error(`Invalid Renderer Slot entry id: ${id}`);
  }
}

function defineRendererSlot(
  input: DefineRendererSlotInput,
  kind: RendererSlotKind,
): RendererAnySlot {
  if (!/^renderer\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(input.id)) {
    throw new Error(`Invalid Renderer Slot id: ${input.id}`);
  }
  return Object.freeze({
    id: input.id,
    kind,
    scope: input.scope,
    userConfigurable: input.userConfigurable ?? false,
  }) as RendererAnySlot;
}
