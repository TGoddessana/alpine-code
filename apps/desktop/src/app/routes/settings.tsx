import { createFileRoute } from '@tanstack/react-router';

import { Settings } from '@/features/settings/Settings';

export const Route = createFileRoute('/settings')({
  component: () => (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <Settings />
    </main>
  ),
});
