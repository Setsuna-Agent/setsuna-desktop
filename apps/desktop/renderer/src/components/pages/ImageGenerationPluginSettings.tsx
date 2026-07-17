import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import {
  normalizeImageGenerationServiceUrl,
  type RuntimeImageGenerationConfigInput,
  type RuntimeImageGenerationConfigState,
} from '@setsuna-desktop/contracts';
import { Button, TextField } from '../primitives.js';

export function ImageGenerationPluginSettings({
  config,
  onSave,
}: {
  config?: RuntimeImageGenerationConfigState;
  onSave: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBaseUrl(config?.baseUrl ?? '');
    setModel(config?.model ?? '');
    setApiKey('');
    setClearApiKey(false);
  }, [config]);

  async function submit() {
    const normalizedUrl = normalizeImageGenerationServiceUrl(baseUrl);
    if (baseUrl.trim() && normalizedUrl === null) {
      setError('服务地址必须是有效的 HTTP 或 HTTPS URL，且不能在 URL 中包含用户名或密码。');
      return;
    }
    if (!normalizedUrl) {
      setError('请填写图片生成服务地址。');
      return;
    }
    if (!clearApiKey && !apiKey.trim() && !config?.apiKeySet) {
      setError('请填写图片生成服务的 API key。');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        baseUrl: normalizedUrl ?? '',
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        clearApiKey,
      });
      setApiKey('');
      setClearApiKey(false);
      setSaved(true);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  }

  const hasSavedKey = Boolean(config?.apiKeySet && !clearApiKey);
  const usesPlainHttp = baseUrl.trim().toLowerCase().startsWith('http://');

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
            disabled={saving}
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
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? '保存中' : '保存配置'}
        </Button>
      </footer>
    </section>
  );
}
