import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useCurrentProject } from '@/features/rail/currentProject';

/** ⌘N anywhere opens a new session in the project the rail shows. */
export function useNewSessionShortcut() {
  const navigate = useNavigate();
  const current = useCurrentProject();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void navigate({ to: '/', search: current ? { project: current } : {} });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, current]);
}
