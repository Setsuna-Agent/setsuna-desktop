import { useEffect, useState } from 'react';
import { Image } from 'antd';
import { Copy, FolderOpen, Loader2, Play } from 'lucide-react';
import type {
  DesktopImageInput,
  RuntimeGeneratedMessageAttachment,
  RuntimeImageGenerationTestResult,
} from '@setsuna-desktop/contracts';
import { RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS } from '@setsuna-desktop/contracts';
import { Button, TextArea } from '../primitives.js';

export function ImageGenerationPluginTest({
  generating,
  onGenerate,
}: {
  generating: boolean;
  onGenerate: (prompt: string) => Promise<RuntimeImageGenerationTestResult>;
}) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuntimeImageGenerationTestResult | null>(null);

  async function generate() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError('请先输入用于测试的生图提示词。');
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
          <h4 id="image-generation-test-title">快速测试</h4>
          <p>会先保存上方配置，再由本机 runtime 直连 Images API；测试请求只携带提示词。</p>
        </div>
        <span>直连 API</span>
      </header>

      <label className="desktop-image-generation-test__prompt">
        <span>提示词</span>
        <TextArea
          rows={4}
          maxLength={RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS}
          value={prompt}
          placeholder="例如：一只戴着飞行员护目镜的橘猫，坐在复古双翼飞机里，电影感光影"
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
          {!error && generating ? <span>正在调用图片生成服务，最长可能需要几分钟…</span> : null}
          {!error && !generating && result ? (
            <span className="is-success">
              连接成功 · {result.images.length} 张 · {formatDuration(result.durationMs)}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          ) : null}
          {!error && !generating && !result ? <span>Ctrl/⌘ + Enter 也可以开始生成</span> : null}
        </div>
        <Button
          type="button"
          variant="primary"
          icon={generating ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />}
          disabled={generating || !prompt.trim()}
          onClick={() => void generate()}
        >
          {generating ? '生成中' : '保存配置并生成'}
        </Button>
      </div>

      {result?.images.length ? (
        <Image.PreviewGroup>
          <div className="desktop-image-generation-test__results" aria-label={`${result.images.length} 张测试图片`}>
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
  const [source, setSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      setLoadError('当前环境无法读取生成图片。');
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
          setLoadError(unknownError instanceof Error ? unknownError.message : '图片读取失败。');
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.assetId]);

  async function runAction(action: 'copy' | 'reveal') {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      setActionError('当前环境无法执行图片操作。');
      return;
    }
    setActionError(null);
    try {
      const input: DesktopImageInput = { assetId: attachment.assetId, name: attachment.name };
      const result = action === 'copy'
        ? await desktop.copyImageToClipboard(input)
        : await desktop.revealImageInFolder(input);
      if (!result.ok) setActionError(result.error);
    } catch (unknownError) {
      setActionError(unknownError instanceof Error ? unknownError.message : '图片操作失败。');
    }
  }

  return (
    <article className="desktop-image-generation-test__image">
      <div className="desktop-image-generation-test__preview">
        {source ? (
          <Image src={source} alt={attachment.name} preview={{ mask: '查看大图' }} />
        ) : (
          <div role={loadError ? 'alert' : 'status'}>{loadError ?? '正在加载图片…'}</div>
        )}
      </div>
      <div className="desktop-image-generation-test__image-footer">
        <span title={attachment.name}>{attachment.name}</span>
        <div>
          <Button type="button" variant="ghost" icon={<Copy size={13} />} onClick={() => void runAction('copy')}>
            复制
          </Button>
          <Button type="button" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void runAction('reveal')}>
            定位
          </Button>
        </div>
      </div>
      {actionError ? <small className="desktop-image-generation-test__action-error" role="alert">{actionError}</small> : null}
    </article>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
}
