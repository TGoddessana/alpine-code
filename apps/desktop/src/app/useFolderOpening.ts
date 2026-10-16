import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { onPathsDropped, useOpenFolder } from '@/shared/platform';
import { useOpenProject } from '@/shared/server';

import { useSkillDrop, type DropOutcome } from './DroppedSkills';

/**
 * ⌘O anywhere opens Finder; a folder dropped on the window becomes a project, and a skill dropped on it (a `.zip`, a
 * `.skill` or a folder with a SKILL.md) is added. Returns what the skill drop came to, for `DroppedSkillsDialog`.
 */
export function useFolderOpening(): [DropOutcome | null, () => void] {
  const navigate = useNavigate();
  const show = useCallback((path: string) => void navigate({ to: '/', search: { project: path } }), [navigate]);
  const openFolder = useOpenFolder(show);
  const { mutate: openProject } = useOpenProject();
  const [dropped, setDropped] = useState<DropOutcome | null>(null);
  const openAsProject = useCallback(
    (path: string) => openProject(path, { onSuccess: ({ project }) => show(project.path) }),
    [openProject, show],
  );
  const takeSkills = useSkillDrop(openAsProject);

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

  // A dropped file that is not a skill is refused by the server (not a folder) and changes nothing.
  useEffect(() => onPathsDropped((paths) => void takeSkills(paths).then(setDropped)), [takeSkills]);
  return [dropped, () => setDropped(null)];
}
