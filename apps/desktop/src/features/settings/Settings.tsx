import { LinkButton, Tabs } from '@alpine/ui/primitives';

import { LOCALES, useLocale, useMessages, type Locale } from '@/shared/i18n';
import { MODES, modeMessages, type Mode } from '@/shared/components/composer';
import { useServerInfo, useSetDefaultMode, useSettings } from '@/shared/server';

import { ConnectionTab } from './Connection';
import { messages } from './messages';

const LANGUAGE_NAMES: Record<Locale, string> = { ko: '한국어', en: 'English' };

export type SettingsTab = 'general' | 'connection' | 'usage' | 'harness';

/** One page with tabs: general, model connection, usage and harness. */
export function Settings({
  tab = 'general',
  onChange,
}: {
  tab?: SettingsTab;
  onChange: (search: { tab: SettingsTab }) => void;
}) {
  const t = useMessages(messages);
  return (
    <div className="flex min-h-0 grow flex-col gap-6 px-6 pt-5">
      <h1 className="text-title">{t.title}</h1>
      <Tabs.Root
        value={tab}
        onValueChange={(value: SettingsTab) => onChange({ tab: value })}
        className="flex min-h-0 grow flex-col"
      >
        <Tabs.List>
          <Tabs.Tab value="general">{t.general}</Tabs.Tab>
          <Tabs.Tab value="connection">{t.connection}</Tabs.Tab>
          <Tabs.Tab value="usage">{t.usage}</Tabs.Tab>
          <Tabs.Tab value="harness">{t.harness}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <General onReviewModel={() => onChange({ tab: 'connection' })} />
        </Tabs.Panel>
        <Tabs.Panel value="connection">
          <ConnectionTab />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function General({ onReviewModel }: { onReviewModel: () => void }) {
  const t = useMessages(messages);
  const { locale, setLocale } = useLocale();
  const server = useServerInfo();
  const m = useMessages(modeMessages);
  const mode = useSettings().data?.mode;
  const setMode = useSetDefaultMode();
  const shownMode = setMode.isPending && setMode.variables ? setMode.variables : mode;
  return (
    <dl className="grid max-w-3xl grid-cols-[160px_1fr] items-center gap-x-6 gap-y-4">
      <dt className="text-fg-muted">
        <label htmlFor="settings-language">{t.language}</label>
      </dt>
      <dd>
        <select
          id="settings-language"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          className="min-h-8 rounded-md border border-line bg-canvas-raised px-2"
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </dd>
      {shownMode && (
        <>
          <dt className="self-start pt-1.5 text-fg-muted">
            <label htmlFor="settings-safety">{t.safety}</label>
          </dt>
          <dd className="flex flex-col items-start gap-2">
            <select
              id="settings-safety"
              value={shownMode}
              onChange={(event) => setMode.mutate(event.target.value as Mode)}
              className={`min-h-8 rounded-md border border-line bg-canvas-raised px-2 ${shownMode === 'yolo' ? 'text-danger' : ''}`}
            >
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {m.name(value)}
                </option>
              ))}
            </select>
            <p className="text-meta text-fg-muted">
              {m.description(shownMode)}
              <br />
              {t.safetyLead}
            </p>
            {shownMode === 'auto' && <LinkButton onClick={onReviewModel}>{t.changeReviewModel}</LinkButton>}
          </dd>
        </>
      )}
      <dt className="text-fg-muted">{t.server}</dt>
      <dd>
        {server.data
          ? t.serverVersion(server.data.server.name, server.data.server.version, server.data.protocolVersion)
          : server.isError && t.serverUnavailable}
      </dd>
    </dl>
  );
}
