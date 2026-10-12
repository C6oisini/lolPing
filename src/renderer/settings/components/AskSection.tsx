import { Input, Textarea } from '@fluentui/react-components';
import { Bot24Regular, DocumentText24Regular, Key24Regular, Server24Regular, Crop24Regular } from '@fluentui/react-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_ASK_BASE_URL, DEFAULT_ASK_MODEL } from '../../../shared/askAi';
import type { Settings } from '../../../shared/settings';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow, SwitchRow } from './rows';

/**
 * A text setting edited locally and saved on Enter or when the field loses focus: sending every keystroke would write
 * settings.json on each one, and a half-typed API key would be saved as it is.
 */
function TextRow(props: {
  icon: ReactNode;
  title: string;
  description?: string;
  value: string;
  placeholder?: string;
  password?: boolean;
  width: number;
  onSave(v: string): void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const save = () => {
    if (draft !== props.value) props.onSave(draft);
  };
  return (
    <SettingRow icon={props.icon} title={props.title} description={props.description}>
      <Input
        type={props.password ? 'password' : 'text'}
        autoComplete="off"
        value={draft}
        placeholder={props.placeholder}
        style={{ width: props.width }}
        onChange={(_, d) => setDraft(d.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </SettingRow>
  );
}

/** The prompt is long enough to deserve a text area, and is saved the same way as the single-line fields. */
function PromptRow({ value, placeholder, title, description, onSave }: {
  value: string;
  placeholder: string;
  title: string;
  description: string;
  onSave(v: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <SettingRow icon={<DocumentText24Regular />} title={title} description={description}>
      <Textarea
        value={draft}
        placeholder={placeholder}
        rows={3}
        resize="vertical"
        style={{ width: 320 }}
        onChange={(_, d) => setDraft(d.value)}
        onBlur={() => draft !== value && onSave(draft)}
      />
    </SettingRow>
  );
}

export function AskSection({ settings: s, update, trigger }: { settings: Settings; update: Update; trigger: string }) {
  const t = useText();
  return (
    <>
      <p className="desc roomNote">{t.askSliceHowDesc(trigger)}</p>
      <TextRow icon={<Key24Regular />} title={t.askApiKey} description={t.askApiKeyDesc} password
        value={s.askAiKey} width={260} onSave={(askAiKey) => void update({ askAiKey })} />
      <TextRow icon={<Bot24Regular />} title={t.askModel} description={t.askModelDesc}
        value={s.askAiModel} placeholder={DEFAULT_ASK_MODEL} width={220} onSave={(askAiModel) => void update({ askAiModel })} />
      <TextRow icon={<Server24Regular />} title={t.askBaseUrl} description={t.askBaseUrlDesc}
        value={s.askAiBaseUrl} placeholder={DEFAULT_ASK_BASE_URL} width={260} onSave={(askAiBaseUrl) => void update({ askAiBaseUrl })} />
      <PromptRow title={t.askPrompt} description={t.askPromptDesc} placeholder={t.askPromptPlaceholder}
        value={s.askAiPrompt} onSave={(askAiPrompt) => void update({ askAiPrompt })} />
      <SwitchRow icon={<Crop24Regular />} title={t.askSelectRegion} description={t.askSelectRegionDesc}
        checked={s.askAiSelectRegion} onChange={(v) => void update({ askAiSelectRegion: v })} />
      <p className="desc roomNote">{t.askShareNote}</p>
    </>
  );
}
