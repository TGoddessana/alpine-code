import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { onPathsDropped, useOpenFolder } from '@/shared/platform';
import { useOpenProject } from '@/shared/server';

/** ⌘O anywhere opens Finder; a folder dropped on the window becomes a project. */
export function useFolderOpening() {
  const navigate = useNavigate();
  const show = useCallback((path: string) => void navigate({ to: '/', search: { project: path } }), [navigate]);
  const openFolder = useOpenFolder(show);
  const { mutate: openProject } = useOpenProject();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openFolder();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openFolder]);

  // A dropped file is refused by the server (not a folder) and changes nothing.
  useEffect(
    () =>
      onPathsDropped((paths) =>
        paths.forEach((path) => openProject(path, { onSuccess: ({ project }) => show(project.path) })),
      ),
    [openProject, show],
  );
}
