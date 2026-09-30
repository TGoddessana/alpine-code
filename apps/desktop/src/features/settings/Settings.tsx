import { Tabs } from '@alpine/ui/primitives';

import { LOCALES, useLocale, useMessages, type Locale } from '@/shared/i18n';
import { useServerInfo } from '@/shared/server';

import { ConnectionTab } from './Connection';
import { messages } from './messages';

const LANGUAGE_NAMES: Record<Locale, string> = { ko: '한국어', en: 'English' };

/** One page with tabs: general, model connection, usage, models and harness. */
export function Settings() {
  const t = useMessages(messages);
  return (
    <div className="flex flex-col gap-6 px-6 py-5">
      <h1 className="text-title">{t.title}</h1>
      <Tabs.Root defaultValue="general">
        <Tabs.List>
          <Tabs.Tab value="general">{t.general}</Tabs.Tab>
          <Tabs.Tab value="connection">{t.connection}</Tabs.Tab>
          <Tabs.Tab value="usage">{t.usage}</Tabs.Tab>
          <Tabs.Tab value="harness">{t.harness}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <General />
        </Tabs.Panel>
        <Tabs.Panel value="connection">
          <ConnectionTab />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function General() {
  const t = useMessages(messages);
  const { locale, setLocale } = useLocale();
  const server = useServerInfo();
  return (
    <dl className="grid max-w-xl grid-cols-[160px_1fr] items-center gap-x-6 gap-y-4">
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
      <dt className="text-fg-muted">{t.server}</dt>
      <dd>
        {server.data
          ? t.serverVersion(server.data.server.name, server.data.server.version, server.data.protocolVersion)
          : server.isError && t.serverUnavailable}
      </dd>
    </dl>
  );
}
