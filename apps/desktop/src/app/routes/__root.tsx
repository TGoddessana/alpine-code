import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { FirstRun } from '@/features/first-run/FirstRun';
import { Rail } from '@/features/rail/Rail';

import { TopBar } from '../TopBar';
import { useFolderOpening } from '../useFolderOpening';

const RAIL_KEY = 'alpine.rail.open';

/** Whether the rail shows, remembered across restarts. */
function useRailOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setOpen((value) => {
      try {
        localStorage.setItem(RAIL_KEY, String(!value));
      } catch {
        // Not remembered, but it still hides and shows.
      }
      return !value;
    });
  }, []);
  return [open, toggle];
}

/**
 * The window: a top bar across the top, and under it the rail (where) beside a floating card holding the rest. Routes
 * fill the card: the centre (what happened) and, for a session, the work result panel (what changed and ran) on its right.
 */
export const Route = createRootRoute({
  component: Root,
});

function Root() {
  useFolderOpening();
  const [railOpen, toggleRail] = useRailOpen();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas-sunken">
      <TopBar railOpen={railOpen} onToggleRail={toggleRail} />
      <div className="flex min-h-0 grow">
        {railOpen && <Rail />}
        <div className="mr-2 mb-2 flex min-w-0 grow overflow-hidden rounded-xl border border-line bg-canvas">
          <Outlet />
        </div>
      </div>
      <FirstRun />
    </div>
  );
}
