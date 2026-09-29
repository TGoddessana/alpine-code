import { createRootRoute, Outlet } from '@tanstack/react-router';

import { Rail } from '@/features/rail/Rail';

/** The three places: rail (where), centre (what happened), right panel (state). Features fill them. */
export const Route = createRootRoute({
  component: () => (
    <div className="flex h-screen overflow-hidden bg-canvas-sunken">
      <Rail />
      <main className="flex min-w-0 grow flex-col bg-canvas">
        <Outlet />
      </main>
    </div>
  ),
});
