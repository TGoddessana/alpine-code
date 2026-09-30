import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { Settings, type SettingsTab } from '@/features/settings/Settings';

const TABS: SettingsTab[] = ['general', 'connection', 'usage', 'tools', 'harness'];

interface Search {
  tab?: SettingsTab;
  profile?: string;
  saved?: string;
}

/** `?tab=` picks the tab; the tools tab also takes `?profile=` and `?saved=` (a tool the editor just saved). */
export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(TABS.includes(search.tab as SettingsTab) ? { tab: search.tab as SettingsTab } : {}),
    ...(typeof search.profile === 'string' ? { profile: search.profile } : {}),
    ...(typeof search.saved === 'string' ? { saved: search.saved } : {}),
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { tab, profile, saved } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <Settings
        tab={tab}
        profile={profile}
        saved={saved}
        onChange={(search) => void navigate({ to: '/settings', search, replace: true })}
      />
    </main>
  );
}
