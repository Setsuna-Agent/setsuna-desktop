import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import {
  normalizeImageGenerationServiceUrl,
  type RuntimeImageGenerationConfigInput,
  type RuntimeImageGenerationConfigState,
  type RuntimeImageGenerationTestInput,
  type RuntimeImageGenerationTestResult,
} from '@setsuna-desktop/contracts';
import { Button, TextField } from '../primitives.js';
import { ImageGenerationPluginTest } from './ImageGenerationPluginTest.js';

export function ImageGenerationPluginSettings({
  config,
  onSave,
  onTest,
}: {
  config?: RuntimeImageGenerationConfigState;
  onSave: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTest: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
}) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBaseUrl(config?.baseUrl ?? '');
    setModel(config?.model ?? '');
    setApiKey('');
    setClearApiKey(false);
  }, [config]);

  function configInput(requireUsableKey: boolean): RuntimeImageGenerationConfigInput {
    const normalizedUrl = normalizeImageGenerationServiceUrl(baseUrl);
    if (baseUrl.trim() && normalizedUrl === null) {
      throw new Error('服务地址必须是有效的 HTTP 或 HTTPS URL，且不能在 URL 中包含用户名或密码。');
    }
    if (!normalizedUrl) {
      throw new Error('请填写图片生成服务地址。');
    }
    const hasUsableKey = Boolean(apiKey.trim()) || Boolean(config?.apiKeySet && !clearApiKey);
    if ((requireUsableKey || !clearApiKey) && !hasUsableKey) {
      throw new Error('请填写图片生成服务的 API key。');
    }
    return {
      baseUrl: normalizedUrl,
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
      clearApiKey,
    };
  }

  async function persistConfig(requireUsableKey: boolean) {
    await onSave(configInput(requireUsableKey));
    setApiKey('');
    setClearApiKey(false);
    setSaved(true);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await persistConfig(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  }

  async function generateTest(prompt: string): Promise<RuntimeImageGenerationTestResult> {
    setTesting(true);
    setError(null);
    setSaved(false);
    try {
      await persistConfig(true);
      return await onTest({ prompt });
    } finally {
      setTesting(false);
    }
  }

  const hasSavedKey = Boolean(config?.apiKeySet && !clearApiKey);
  const usesPlainHttp = baseUrl.trim().toLowerCase().startsWith('http://');
  const busy = saving || testing;

  return (
    <section className="desktop-image-generation-settings" aria-labelledby="image-generation-settings-title">
      <header>
        <span className="desktop-image-generation-settings__icon"><KeyRound size={16} /></span>
        <div>
          <h3 id="image-generation-settings-title">服务配置</h3>
          <p>安装插件后自动启用；兼容 OpenAI Images API，密钥只保存在本机 runtime 的私密配置中。</p>
        </div>
      </header>

      <div className="desktop-image-generation-settings__form">
        <label className="desktop-image-generation-settings__field desktop-image-generation-settings__field--wide">
          <span>服务地址</span>
          <TextField
            type="url"
            value={baseUrl}
            placeholder="http://127.0.0.1:8000 或 https://api.example.com/v1"
            spellCheck={false}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setSaved(false);
            }}
          />
          <small>可填写服务根地址、以 /v1 结尾的地址，或完整的 /v1/images/generations 端点。</small>
        </label>

        <label className="desktop-image-generation-settings__field">
          <span>默认模型（可选）</span>
          <TextField
            value={model}
            placeholder="例如 gpt-image-1"
            spellCheck={false}
            onChange={(event) => {
              setModel(event.target.value);
              setSaved(false);
            }}
          />
        </label>

        <label className="desktop-image-generation-settings__field">
          <span>API key</span>
          <TextField
            type="password"
            value={apiKey}
            autoComplete="new-password"
            placeholder={hasSavedKey ? config?.apiKeyPreview || '已保存' : '输入 API key'}
            spellCheck={false}
            onChange={(event) => {
              setApiKey(event.target.value);
              if (event.target.value) setClearApiKey(false);
              setSaved(false);
            }}
          />
        </label>
      </div>

      {usesPlainHttp ? (
        <p className="desktop-image-generation-settings__warning" role="note">
          当前使用 HTTP，API key 和请求内容在网络传输中不会被 TLS 加密。仅建议用于可信内网或本机服务。
        </p>
      ) : null}

      <footer>
        <div className="desktop-image-generation-settings__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && saved ? <span className="is-success">配置已保存</span> : null}
          {!error && !saved && clearApiKey ? <span>保存后将清除密钥；重新填写密钥后即可继续使用</span> : null}
          {!error && !saved && hasSavedKey ? <span>已保存密钥 {config?.apiKeyPreview}</span> : null}
        </div>
        {hasSavedKey ? (
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={() => {
              setClearApiKey(true);
              setApiKey('');
              setSaved(false);
            }}
          >
            清除密钥
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          icon={saving ? <Loader2 className="is-spinning" size={14} /> : <Save size={14} />}
          disabled={busy}
          onClick={() => void submit()}
        >
          {saving ? '保存中' : '保存配置'}
        </Button>
      </footer>

      <ImageGenerationPluginTest generating={testing} onGenerate={generateTest} />
    </section>
  );
}
