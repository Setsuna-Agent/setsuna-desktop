import { ExternalLink } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';

const SETUP_STEPS = ['create', 'connect', 'message', 'authorize'] as const;

export function AssistantQqGuide({ translate: t }: { translate: RendererTranslate }) {
  return <div className="assistant-qq-guide">
    <ol className="assistant-qq-guide__steps">
      {SETUP_STEPS.map((step) => <li key={step}>
        <h3>{t(`feature.assistants.qqGuide.${step}.title`)}</h3>
        <p>{t(`feature.assistants.qqGuide.${step}.description`)}</p>
      </li>)}
    </ol>
    <p>{t('feature.assistants.qqGuide.keepRunning')}</p>
    <section className="assistant-qq-guide__notice">
      <h3>{t('feature.assistants.qqGuide.singleDevice.title')}</h3>
      <p>{t('feature.assistants.qqGuide.singleDevice.description')}</p>
      <p>{t('feature.assistants.qqGuide.singleDevice.switch')}</p>
    </section>
    <div className="assistant-qq-guide__links">
      <a className="assistant-qq-guide__link" href="https://q.qq.com/" target="_blank" rel="noopener noreferrer">
        {t('feature.assistants.qqGuide.platform')}<ExternalLink size={14} aria-hidden="true" />
      </a>
      <a className="assistant-qq-guide__link" href="https://bot.q.qq.com/wiki/" target="_blank" rel="noopener noreferrer">
        {t('feature.assistants.qqGuide.documentation')}<ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  </div>;
}
