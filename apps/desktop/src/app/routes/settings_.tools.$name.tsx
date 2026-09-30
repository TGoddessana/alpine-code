import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ToolEditor } from '@/features/settings/ToolEditor';

/** A tool file in the editor; `new` for a new one. `?profile=` is the profile to return to and turn it on in. */
export const Route = createFileRoute('/settings_/tools/$name')({
  validateSearch: (search: Record<string, unknown>): { profile?: string } =>
    typeof search.profile === 'string' ? { profile: search.profile } : {},
  component: ToolEditorRoute,
});

function ToolEditorRoute() {
  const { name } = Route.useParams();
  const { profile } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <ToolEditor
        key={name}
        name={name}
        profile={profile}
        onDone={(added) =>
          void navigate({ to: '/settings', search: { tab: 'tools', profile, ...(added ? { saved: added } : {}) } })
        }
      />
    </main>
  );
}
