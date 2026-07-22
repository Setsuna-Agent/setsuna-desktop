import type {
  RuntimeGeneratedMessageAttachment,
  RuntimeImageGenerationTestResult,
} from '@setsuna-desktop/contracts';
import { RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS } from '@setsuna-desktop/contracts';
import { Image } from 'antd';
import { Copy, FolderOpen, Loader2, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, TextArea } from '../../shared/ui/primitives.js';
import { useDesktopImageAction, type DesktopImageAction } from '../workspace/hooks/useDesktopImageAction.js';

export function ImageGenerationPluginTest({
  generating,
  onGenerate,
}: {
  generating: boolean;
  onGenerate: (prompt: string) => Promise<RuntimeImageGenerationTestResult>;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuntimeImageGenerationTestResult | null>(null);

  async function generate() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError(t('capabilities.image.test.promptRequired'));
      return;
    }
    setError(null);
    try {
      setResult(await onGenerate(normalizedPrompt));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }

  return (
    <section className="desktop-image-generation-test" aria-labelledby="image-generation-test-title">
      <header>
        <div>
          <h4 id="image-generation-test-title">{t('capabilities.image.test.title')}</h4>
          <p>{t('capabilities.image.test.description')}</p>
        </div>
        <span>{t('capabilities.image.test.directApi')}</span>
      </header>

      <label className="desktop-image-generation-test__prompt">
        <span>{t('capabilities.image.test.prompt')}</span>
        <TextArea
          rows={4}
          maxLength={RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS}
          value={prompt}
          placeholder={t('capabilities.image.test.promptPlaceholder')}
          disabled={generating}
          onChange={(event) => {
            setPrompt(event.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!generating) void generate();
            }
          }}
        />
      </label>

      <div className="desktop-image-generation-test__controls">
        <div className="desktop-image-generation-test__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && generating ? <span>{t('capabilities.image.test.generatingStatus')}</span> : null}
          {!error && !generating && result ? (
            <span className="is-success">
              {t('capabilities.image.test.success', { count: result.images.length, duration: formatDuration(result.durationMs, t) })}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          ) : null}
          {!error && !generating && !result ? <span>{t('capabilities.image.test.shortcut')}</span> : null}
        </div>
        <Button
          type="button"
          variant="primary"
          icon={generating ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />}
          disabled={generating || !prompt.trim()}
          onClick={() => void generate()}
        >
          {t(generating ? 'capabilities.image.test.generating' : 'capabilities.image.test.generate')}
        </Button>
      </div>

      {result?.images.length ? (
        <Image.PreviewGroup>
          <div className="desktop-image-generation-test__results" aria-label={t('capabilities.image.test.results', { count: result.images.length })}>
            {result.images.map((attachment) => (
              <QuickTestImage attachment={attachment} key={attachment.assetId} />
            ))}
          </div>
        </Image.PreviewGroup>
      ) : null}
    </section>
  );
}

function QuickTestImage({ attachment }: { attachment: RuntimeGeneratedMessageAttachment }) {
  const { t } = useI18n();
  const runDesktopImageAction = useDesktopImageAction();
  const [source, setSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      setLoadError(t('capabilities.image.test.readUnavailable'));
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setSource(null);
    setLoadError(null);
    void desktop.readImageAsset(attachment.assetId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadError(result.error);
          return;
        }
        const bytes = Uint8Array.from(result.data);
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.type }));
        setSource(objectUrl);
      })
      .catch((unknownError: unknown) => {
        if (!cancelled) {
          setLoadError(unknownError instanceof Error ? unknownError.message : t('capabilities.image.test.readFailed'));
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.assetId, t]);

  const runAction = (action: DesktopImageAction) => runDesktopImageAction(action, {
    assetId: attachment.assetId,
    name: attachment.name,
  });

  return (
    <article className="desktop-image-generation-test__image">
      <div className="desktop-image-generation-test__preview">
        {source ? (
          <Image src={source} alt={attachment.name} preview={{ mask: t('capabilities.image.test.preview') }} />
        ) : (
          <div role={loadError ? 'alert' : 'status'}>{loadError ?? t('capabilities.image.test.loading')}</div>
        )}
      </div>
      <div className="desktop-image-generation-test__image-footer">
        <span title={attachment.name}>{attachment.name}</span>
        <div>
          <Button type="button" variant="ghost" icon={<Copy size={13} />} onClick={() => void runAction('copy')}>
            {t('capabilities.image.test.copy')}
          </Button>
          <Button type="button" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void runAction('reveal')}>
            {t('capabilities.image.test.reveal')}
          </Button>
        </div>
      </div>
    </article>
  );
}

function formatDuration(durationMs: number, t: Translate): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return t('capabilities.image.test.seconds', { seconds: (durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0) });
}
