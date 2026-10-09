import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { Settings, type SettingsTab } from '@/features/settings/Settings';

const TABS: SettingsTab[] = ['general', 'connection', 'usage', 'harness'];

interface Search {
  tab?: SettingsTab;
}

/** `?tab=` picks the tab. */
export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(TABS.includes(search.tab as SettingsTab) ? { tab: search.tab as SettingsTab } : {}),
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <Settings
        tab={tab}
        onChange={(search) => void navigate({ to: '/settings', search, replace: true })}
      />
    </main>
  );
}
