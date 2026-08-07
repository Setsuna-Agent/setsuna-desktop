import {
  RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type RuntimeVisionRecognitionTestResult,
} from '@setsuna-desktop/contracts';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, TextArea } from '../../shared/ui/primitives.js';

export function VisionRecognitionPluginTest({
  disabled = false,
  testing,
  onAnalyze,
}: {
  disabled?: boolean;
  testing: boolean;
  onAnalyze: (prompt: string) => Promise<RuntimeVisionRecognitionTestResult>;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(() => t('capabilities.vision.test.promptDefault'));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuntimeVisionRecognitionTestResult | null>(null);

  async function analyze() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError(t('capabilities.vision.test.promptRequired'));
      return;
    }
    setError(null);
    try {
      setResult(await onAnalyze(normalizedPrompt));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }

  return (
    <section className="desktop-image-generation-test desktop-vision-recognition-test" aria-labelledby="vision-recognition-test-title">
      <header>
        <div>
          <h4 id="vision-recognition-test-title">{t('capabilities.vision.test.title')}</h4>
          <p>{t('capabilities.vision.test.description')}</p>
        </div>
        <span>{t('capabilities.vision.test.directApi')}</span>
      </header>

      <label className="desktop-image-generation-test__prompt">
        <span>{t('capabilities.vision.test.prompt')}</span>
        <TextArea
          rows={3}
          maxLength={RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS}
          value={prompt}
          disabled={disabled || testing}
          onChange={(event) => {
            setPrompt(event.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!disabled && !testing) void analyze();
            }
          }}
        />
      </label>

      <div className="desktop-image-generation-test__controls">
        <div className="desktop-image-generation-test__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && testing ? <span>{t('capabilities.vision.test.testingStatus')}</span> : null}
          {!error && !testing && result ? (
            <span className="is-success">
              {t('capabilities.vision.test.success', { duration: formatDuration(result.durationMs, t) })}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          ) : null}
          {!error && !testing && !result ? <span>{t('capabilities.vision.test.shortcut')}</span> : null}
        </div>
        <Button
          type="button"
          variant="primary"
          icon={testing ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />}
          disabled={disabled || testing || !prompt.trim()}
          onClick={() => void analyze()}
        >
          {t(testing ? 'capabilities.vision.test.testing' : 'capabilities.vision.test.run')}
        </Button>
      </div>

      {result ? (
        <pre className="desktop-vision-recognition-test__result" aria-label={t('capabilities.vision.test.result')}>
          {result.content}
        </pre>
      ) : null}
    </section>
  );
}

function formatDuration(durationMs: number, t: Translate): string {
  return t('capabilities.vision.test.seconds', {
    seconds: (durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0),
  });
}
