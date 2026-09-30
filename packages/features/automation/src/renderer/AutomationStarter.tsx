import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';
import { ClipboardList, ListTodo, Newspaper } from 'lucide-react';

const starterSuggestions = [
  { key: 'briefing', Icon: Newspaper },
  { key: 'dailyPlan', Icon: ListTodo },
  { key: 'weeklySummary', Icon: ClipboardList },
] as const;

export function AutomationStarter({ translate: t }: { translate: RendererTranslate }) {
  return (
    <div className="automation-starter chat-starter__title chat-starter__reveal chat-starter__reveal--question">
      <h1>{t('feature.automation.starter.title')}</h1>
      <p>{t('feature.automation.starter.prompt')}</p>
    </div>
  );
}

export function AutomationStarterSuggestions({ translate: t, onSelect }: {
  translate: RendererTranslate;
  onSelect(prompt: string): void;
}) {
  return (
    <div className="automation-starter__suggestions">
      {starterSuggestions.map(({ key, Icon }) => {
        const prompt = t(`feature.automation.starter.suggestion.${key}`);
        return (
          <Button key={key} variant="ghost" className="automation-starter__suggestion"
            icon={<Icon size={16} aria-hidden="true" />} onClick={() => onSelect(prompt)}>
            {prompt}
          </Button>
        );
      })}
    </div>
  );
}
