import { createRootRoute, Outlet } from '@tanstack/react-router';

import { FirstRun } from '@/features/first-run/FirstRun';
import { Rail } from '@/features/rail/Rail';

import { useFolderOpening } from '../useFolderOpening';

/** The three places: rail (where), centre (what happened), right panel (state). Routes fill the last two. */
export const Route = createRootRoute({
  component: Root,
});

function Root() {
  useFolderOpening();
  return (
    <div className="flex h-screen overflow-hidden bg-canvas-sunken">
      <Rail />
      <Outlet />
      <FirstRun />
    </div>
  );
}
