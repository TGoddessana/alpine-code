import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { FirstRun } from '@/features/first-run/FirstRun';
import { Rail } from '@/features/rail/Rail';
import { NavigationController } from '@/features/rail/NavigationController';
import { useCloneUpdates } from '@/shared/server';

import { DroppedSkillsDialog } from '../DroppedSkills';
import { TopBar } from '../TopBar';
import { useAppMenu } from '../useAppMenu';
import { useFolderOpening } from '../useFolderOpening';
import { useNewSessionShortcut } from '../useNewSessionShortcut';

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
 * fill the card: the centre (what happened) and, for a session or the product map, the right dock (work result, later surfaces) on its right.
 */
export const Route = createRootRoute({
  component: Root,
});

function Root() {
  const [dropped, closeDropped, openFolder] = useFolderOpening();
  const [railOpen, toggleRail] = useRailOpen();
  const page = useRouterState({ select: (state) => state.location.pathname + (state.location.search.project ?? '') });
  const onNewSession = useRouterState({ select: (state) => state.location.pathname === '/' });
  useCloneUpdates();
  const newSession = useNewSessionShortcut();
  useAppMenu(railOpen, { newSession, openFolder, toggleRail });
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas-sunken">
      <TopBar railOpen={railOpen} onToggleRail={toggleRail} />
      <div className="flex min-h-0 grow">
        <Rail open={railOpen} />
        <div className="mr-2 mb-2 flex min-w-0 grow overflow-hidden rounded-xl border border-line bg-canvas">
          <div key={page} className="motion-page flex min-h-0 min-w-0 grow">
            <Outlet />
          </div>
        </div>
      </div>
      <NavigationController />
      <FirstRun auto={onNewSession} />
      <DroppedSkillsDialog outcome={dropped} onClose={closeDropped} />
    </div>
  );
}
