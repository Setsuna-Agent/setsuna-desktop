import {
  defaultModelMaxOutputTokens,
  type BrandIconConfig,
  type ProviderConfigState,
  type ProviderModelConfig,
  type RuntimeAvailableModelsResponse,
  type RuntimeConfigState,
  type RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import { providerModelReplacementDecision } from '../providerModelReplacement.js';
import {
  defaultProviderConfig,
  defaultProviderModel,
  ensureProviderActiveModel,
  hasProviderModel,
  mergeFetchedModels,
  modelWithIcon,
  normalizeProviderModel,
  normalizeSettingsProviders,
  providerWithIcon,
  selectedProviderIdFromConfig,
  selectedProviderIdFromProviders,
} from './provider-model.js';
import { type SaveState, useProviderAutoSave } from './useProviderAutoSave.js';

type ModelFetchState = {
  error: string;
  fetching: boolean;
  message: string;
};

type EditingModelState = {
  providerId: string;
} & ({ mode: 'edit'; modelId: string } | { mode: 'create'; model: ProviderModelConfig });

type PendingModelReplacement = {
  providerId: string;
  providerName: string;
  currentModels: ProviderModelConfig[];
  nextModels: ProviderModelConfig[];
};

type ModelIconTarget = {
  providerId: string;
  modelId: string;
};

export function emptyModelFetchState(): ModelFetchState {
  return { error: '', fetching: false, message: '' };
}

function modelFetchSuccessMessage(
  decision: ReturnType<typeof providerModelReplacementDecision>,
  modelCount: number,
  t: Translate,
): string {
  if (decision === 'confirm') return t('settings.providers.fetchConfirm', { count: modelCount });
  if (decision === 'unchanged') return t('settings.providers.fetchUnchanged', { count: modelCount });
  return t('settings.providers.fetchApplied', { count: modelCount });
}

export function useProviderSettingsController({
  config,
  onFetchModels,
  onSave,
  onSaveStateChange,
  t,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
  t: Translate;
}) {
  const createDefaultProvider = useCallback(
    () => defaultProviderConfig(t('settings.providers.newService')),
    [t],
  );
  const providerFallbackNames = useMemo(() => ({
    model: t('settings.providers.newModel'),
    provider: t('settings.providers.newService'),
  }), [t]);
  const [providers, setProviders] = useState<ProviderConfigState[]>(() => (
    normalizeSettingsProviders(config.providers, createDefaultProvider, providerFallbackNames)
  ));
  const [selectedProviderId, setSelectedProviderId] = useState(() => selectedProviderIdFromConfig(config));
  const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
  const [editingModelIcon, setEditingModelIcon] = useState<ModelIconTarget | null>(null);
  const [editingProviderIconId, setEditingProviderIconId] = useState<string | null>(null);
  const [pendingModelReplacement, setPendingModelReplacement] = useState<PendingModelReplacement | null>(null);
  const [apiKeysByProviderId, setApiKeysByProviderId] = useState<Record<string, string>>({});
  const [fetchStateByProviderId, setFetchStateByProviderId] = useState<Record<string, ModelFetchState>>({});
  const providersRef = useRef(providers);
  providersRef.current = providers;

  const markDirty = useProviderAutoSave({
    apiKeysByProviderId,
    onSave,
    onSaveStateChange,
    providers,
    savedMessage: t('settings.providers.applied'),
    savingMessage: t('settings.providers.applying'),
  });

  useEffect(() => {
    const nextProviders = normalizeSettingsProviders(config.providers, createDefaultProvider, providerFallbackNames);
    setProviders(nextProviders);
    setSelectedProviderId((current) => (
      nextProviders.some((provider) => provider.id === current)
        ? current
        : selectedProviderIdFromProviders(config.activeProviderId, nextProviders)
    ));
    setApiKeysByProviderId((current) => {
      const providerIds = new Set(nextProviders.map((provider) => provider.id));
      return Object.fromEntries(Object.entries(current).filter(([providerId]) => providerIds.has(providerId)));
    });
    setEditingModel((current) => {
      if (!current) return null;
      if (!nextProviders.some((provider) => provider.id === current.providerId)) return null;
      if (current.mode === 'create') return current;
      return hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null;
    });
    setEditingProviderIconId((current) => (
      current && nextProviders.some((provider) => provider.id === current) ? current : null
    ));
    setEditingModelIcon((current) => (
      current && hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null
    ));
    setPendingModelReplacement((current) => (
      current && nextProviders.some((provider) => provider.id === current.providerId) ? current : null
    ));
    setFetchStateByProviderId({});
  }, [config.activeProviderId, config.providers, createDefaultProvider, providerFallbackNames]);

  const updateProvider = useCallback((
    providerId: string,
    updater: (provider: ProviderConfigState) => ProviderConfigState,
  ) => {
    markDirty();
    setProviders((current) => current.map((provider) => (provider.id === providerId ? updater(provider) : provider)));
  }, [markDirty]);

  const setProviderApiKey = useCallback((providerId: string, value: string) => {
    markDirty();
    setApiKeysByProviderId((current) => ({ ...current, [providerId]: value }));
  }, [markDirty]);

  const addProvider = useCallback(() => {
    const nextProvider = createDefaultProvider();
    markDirty();
    setProviders((current) => [...current, nextProvider]);
    setSelectedProviderId(nextProvider.id);
  }, [createDefaultProvider, markDirty]);

  const removeProvider = useCallback((providerId: string) => {
    setEditingProviderIconId((current) => (current === providerId ? null : current));
    setEditingModelIcon((current) => (current?.providerId === providerId ? null : current));
    markDirty();
    setProviders((current) => {
      const removedIndex = Math.max(0, current.findIndex((provider) => provider.id === providerId));
      const remaining = current.filter((provider) => provider.id !== providerId);
      const next = remaining.length ? remaining : [createDefaultProvider()];
      setSelectedProviderId((selected) => (
        selected === providerId
          ? next[Math.min(removedIndex, next.length - 1)]?.id ?? next[0]?.id ?? ''
          : selected
      ));
      return next;
    });
    setApiKeysByProviderId((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  }, [createDefaultProvider, markDirty]);

  const addModel = useCallback((providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    setEditingModel({
      mode: 'create',
      providerId,
      model: defaultProviderModel('', !provider?.models.length, provider?.provider, ''),
    });
  }, [providers]);

  const removeModel = useCallback((providerId: string, modelId: string) => {
    setEditingModel((current) => (
      current?.mode === 'edit' && current.providerId === providerId && current.modelId === modelId ? null : current
    ));
    setEditingModelIcon((current) => (
      current?.providerId === providerId && current.modelId === modelId ? null : current
    ));
    updateProvider(providerId, (provider) => ensureProviderActiveModel({
      ...provider,
      models: provider.models.filter((model) => model.id !== modelId),
    }, t('settings.providers.newModel')));
  }, [t, updateProvider]);

  const commitEditingModel = useCallback((nextModel: ProviderModelConfig) => {
    const current = editingModel;
    if (!current) return;
    updateProvider(current.providerId, (provider) => {
      const models = current.mode === 'create'
        ? [
            ...provider.models,
            normalizeProviderModel(
              nextModel,
              provider.models.length === 0,
              provider.provider,
              t('settings.providers.newModel'),
            ),
          ]
        : provider.models.map((model) => (
            model.id === current.modelId
              ? normalizeProviderModel(
                  { ...nextModel, id: current.modelId },
                  model.enabled,
                  provider.provider,
                  t('settings.providers.newModel'),
                )
              : model
          ));
      return ensureProviderActiveModel({ ...provider, models }, t('settings.providers.newModel'));
    });
    setEditingModel(null);
  }, [editingModel, t, updateProvider]);

  const fetchModels = useCallback((provider: ProviderConfigState) => {
    setFetchStateByProviderId((current) => ({
      ...current,
      [provider.id]: { error: '', fetching: true, message: '' },
    }));
    void onFetchModels({
      providerId: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: apiKeysByProviderId[provider.id] || undefined,
      proxyRoute: provider.proxyRoute,
    })
      .then((result) => {
        const currentProvider = providersRef.current.find((item) => item.id === provider.id);
        if (!currentProvider) return;
        const nextModels = mergeFetchedModels(
          currentProvider.models,
          result.models,
          currentProvider.provider,
          t('settings.providers.newModel'),
        );
        const decision = providerModelReplacementDecision(currentProvider.models, nextModels);
        if (decision === 'confirm') {
          setPendingModelReplacement({
            providerId: provider.id,
            providerName: currentProvider.name,
            currentModels: currentProvider.models,
            nextModels,
          });
        } else if (decision === 'apply') {
          updateProvider(provider.id, (item) => ({ ...item, models: nextModels }));
        }
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            error: '',
            fetching: false,
            message: modelFetchSuccessMessage(decision, result.models.length, t),
          },
        }));
      })
      .catch((error) => {
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            ...(current[provider.id] ?? emptyModelFetchState()),
            error: error instanceof Error ? error.message : String(error),
            fetching: false,
            message: '',
          },
        }));
      });
  }, [apiKeysByProviderId, onFetchModels, t, updateProvider]);

  const cancelModelReplacement = useCallback(() => {
    if (!pendingModelReplacement) return;
    const { providerId } = pendingModelReplacement;
    setPendingModelReplacement(null);
    setFetchStateByProviderId((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] ?? emptyModelFetchState()),
        message: t('settings.providers.replacementCanceled'),
      },
    }));
  }, [pendingModelReplacement, t]);

  const confirmModelReplacement = useCallback(() => {
    if (!pendingModelReplacement) return;
    const { nextModels, providerId } = pendingModelReplacement;
    setPendingModelReplacement(null);
    updateProvider(providerId, (provider) => ({ ...provider, models: nextModels }));
    setFetchStateByProviderId((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] ?? emptyModelFetchState()),
        message: t('settings.providers.replacementConfirmed', { count: nextModels.length }),
      },
    }));
  }, [pendingModelReplacement, t, updateProvider]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const editingProvider = editingModel
    ? providers.find((provider) => provider.id === editingModel.providerId)
    : undefined;
  const editingModelConfig = editingModel?.mode === 'create'
    ? editingModel.model
    : editingProvider?.models.find((model) => model.id === editingModel?.modelId);
  const editingProviderIcon = editingProviderIconId
    ? providers.find((provider) => provider.id === editingProviderIconId)
    : undefined;
  const editingModelIconProvider = editingModelIcon
    ? providers.find((provider) => provider.id === editingModelIcon.providerId)
    : undefined;
  const editingModelIconConfig = editingModelIconProvider?.models.find((model) => model.id === editingModelIcon?.modelId);

  return {
    apiKeysByProviderId,
    editingModelDialog: editingModel && editingProvider && editingModelConfig ? {
      defaultMaxOutputTokens: defaultModelMaxOutputTokens(editingProvider.provider),
      key: `${editingModel.mode}-${editingProvider.id}-${editingModelConfig.id}`,
      model: editingModelConfig,
    } : null,
    editingModelIcon: editingModelIconProvider && editingModelIconConfig ? {
      model: editingModelIconConfig,
      provider: editingModelIconProvider,
    } : null,
    editingProviderIcon,
    enabledProviderCount: providers.filter((provider) => provider.enabled).length,
    pendingModelReplacement,
    providers,
    selectedFetchState: selectedProvider
      ? fetchStateByProviderId[selectedProvider.id] ?? emptyModelFetchState()
      : emptyModelFetchState(),
    selectedProvider,
    selectedProviderIndex: selectedProvider
      ? providers.findIndex((provider) => provider.id === selectedProvider.id)
      : -1,
    actions: {
      addModel,
      addProvider,
      cancelModelReplacement,
      closeModelEditor: () => setEditingModel(null),
      closeModelIconEditor: () => setEditingModelIcon(null),
      closeProviderIconEditor: () => setEditingProviderIconId(null),
      commitEditingModel,
      confirmModelIcon: (icon: BrandIconConfig | undefined) => {
        if (!editingModelIconProvider || !editingModelIconConfig) return;
        updateProvider(editingModelIconProvider.id, (provider) => ({
          ...provider,
          models: provider.models.map((model) => (
            model.id === editingModelIconConfig.id ? modelWithIcon(model, icon) : model
          )),
        }));
        setEditingModelIcon(null);
      },
      confirmModelReplacement,
      confirmProviderIcon: (icon: BrandIconConfig | undefined) => {
        if (!editingProviderIcon) return;
        updateProvider(editingProviderIcon.id, (provider) => providerWithIcon(provider, icon));
        setEditingProviderIconId(null);
      },
      editModel: (providerId: string, modelId: string) => setEditingModel({ mode: 'edit', providerId, modelId }),
      fetchModels,
      openModelIconEditor: (providerId: string, modelId: string) => setEditingModelIcon({ providerId, modelId }),
      openProviderIconEditor: setEditingProviderIconId,
      removeModel,
      removeProvider,
      resetModelFetchState: (providerId: string) => {
        setFetchStateByProviderId((current) => ({ ...current, [providerId]: emptyModelFetchState() }));
      },
      selectProvider: setSelectedProviderId,
      setProviderApiKey,
      updateProvider,
    },
  };
}
