import { OptionList, Tabs } from '@alpine/ui/primitives';

import { LOCALES, useLocale, useMessages, type Locale } from '@/shared/i18n';
import { MODES, modeMessages, type Mode } from '@/shared/components/composer';
import { useServerInfo, useSetDefaultMode, useSettings } from '@/shared/server';

import { ConnectionTab } from './Connection';
import { messages } from './messages';
import { ToolsTab } from './Tools';

const LANGUAGE_NAMES: Record<Locale, string> = { ko: '한국어', en: 'English' };

export type SettingsTab = 'general' | 'connection' | 'usage' | 'tools' | 'harness';

/** One page with tabs: general, model connection, usage, tools, models and harness. */
export function Settings({
  tab = 'general',
  profile,
  saved,
  onChange,
}: {
  tab?: SettingsTab;
  /** The profile the tools tab shows. */
  profile?: string;
  /** A tool just saved from the editor, which the tools tab confirms. */
  saved?: string;
  onChange: (search: { tab: SettingsTab; profile?: string }) => void;
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
          <Tabs.Tab value="tools">{t.tools}</Tabs.Tab>
          <Tabs.Tab value="harness">{t.harness}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <General />
        </Tabs.Panel>
        <Tabs.Panel value="connection">
          <ConnectionTab />
        </Tabs.Panel>
        <Tabs.Panel value="tools" className="flex min-h-0 grow pt-0">
          <ToolsTab
            profileId={profile}
            saved={saved}
            onProfileChange={(id) => onChange({ tab: 'tools', profile: id })}
          />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function General() {
  const t = useMessages(messages);
  const { locale, setLocale } = useLocale();
  const server = useServerInfo();
  const m = useMessages(modeMessages);
  const mode = useSettings().data?.mode;
  const setMode = useSetDefaultMode();
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
      {mode && (
        <>
          <dt className="self-start pt-2 text-fg-muted">{t.safety}</dt>
          <dd className="flex flex-col gap-2">
            <OptionList<Mode>
              aria-label={t.safety}
              value={setMode.isPending && setMode.variables ? setMode.variables : mode}
              onValueChange={(value) => setMode.mutate(value)}
              options={MODES.map((value) => ({
                value,
                label: <span className={value === 'yolo' ? 'text-danger' : undefined}>{m.name(value)}</span>,
                description: m.description(value),
              }))}
            />
            <p className="text-meta text-fg-muted">{t.safetyLead}</p>
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
