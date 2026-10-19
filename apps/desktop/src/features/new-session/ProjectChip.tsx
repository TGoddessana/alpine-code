import type { ProjectInfo } from '@alpine/protocol';
import { Menu } from '@alpine/ui/primitives';
import { ChevronDown, Folder, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { chipClass } from '@/shared/components/composer';
import { ProjectAddDialog, projectAddMessages } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';
import { tildePath, useHomeDir } from '@/shared/platform';
import { useProjects } from '@/shared/server';

import { messages } from './messages';

/**
 * The folder a new session starts in, as a chip first in the input bar: a folder and the project's name, or (making a
 * new project, `project` is `null`) sparkles and 새 프로젝트. It opens the projects that are not archived, the current
 * one checked, then 프로젝트 추가…, which opens the same dialog as the rail's +. Picking a project calls `onChange`
 * with its folder (which also leaves 새로 만들기); the dialog's 새로 만들기 calls `onNewProject`. `disabled` while a
 * project is being made, because the screen must stay on it.
 */
export function ProjectChip({
  project,
  disabled = false,
  onChange,
  onNewProject,
}: {
  project: ProjectInfo | null;
  disabled?: boolean;
  onChange: (path: string) => void;
  onNewProject: () => void;
}) {
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const home = useHomeDir();
  const [adding, setAdding] = useState(false);
  const projects = useProjects().data?.projects.filter((p) => !p.archived) ?? [];
  const label = project?.name ?? t.newProjectChip;
  const Icon = project ? Folder : Sparkles;
  return (
    <>
      <Menu.Root>
        <Menu.Trigger disabled={disabled} className={chipClass} aria-label={t.projectLabel(label)}>
          <span aria-hidden="true" className="flex size-5.5 shrink-0 items-center justify-center">
            <Icon size={16} strokeWidth={1.5} />
          </span>
          <span className="max-w-40 truncate text-fg">{label}</span>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Popup side="top" align="start" className="max-h-80 w-80 overflow-y-auto">
          <p className="px-2 py-1 text-meta text-fg-muted">{t.projectMenuTitle}</p>
          <Menu.RadioGroup
            value={project?.path ?? ''}
            onValueChange={(path: string) => path !== project?.path && onChange(path)}
          >
            {projects.map((p) => (
              <Menu.RadioItem key={p.path} value={p.path}>
                <Folder size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden="true" />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-meta text-fg-muted">{tildePath(p.path, home)}</span>
                </span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          {projects.length > 0 && <Menu.Separator />}
          <Menu.Item onClick={() => setAdding(true)}>{added.addProjectItem}</Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <ProjectAddDialog open={adding} onOpenChange={setAdding} onDone={onChange} onNew={onNewProject} />
    </>
  );
}
