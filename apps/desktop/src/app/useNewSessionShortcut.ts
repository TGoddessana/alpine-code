import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { useCurrentProject } from '@/features/rail/currentProject';
import { inTauri } from '@/shared/platform';

/**
 * Opens a new session in the project the rail shows. ⌘N reaches it through the menu bar in the app, and through this
 * key listener in a plain browser.
 */
export function useNewSessionShortcut(): () => void {
  const navigate = useNavigate();
  const current = useCurrentProject();
  const newSession = useCallback(
    () => void navigate({ to: '/', search: current ? { project: current } : {} }),
    [navigate, current],
  );
  useEffect(() => {
    if (inTauri()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newSession();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newSession]);
  return newSession;
}
