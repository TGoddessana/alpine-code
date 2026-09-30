import type { ProjectInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { useState } from 'react';

import { GitBar } from '@/shared/components/git';
import { useMessages } from '@/shared/i18n';
import { tildePath, useHomeDir, useOpenFolder } from '@/shared/platform';

import { CloneDialog } from './CloneDialog';
import { Composer } from './Composer';
import { messages } from './messages';

/** Board NewSession: pick the project under the input, then type. Where it runs shows in the header, its git beside the project. */
export function NewSession({
  projects,
  project,
  onProjectChange,
}: {
  projects: ProjectInfo[];
  project: ProjectInfo;
  onProjectChange: (path: string) => void;
}) {
  const t = useMessages(messages);
  const home = useHomeDir();
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  const where = [project.name, tildePath(project.path, home), t.local].join(' · ');

  return (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <header className="flex min-h-14 shrink-0 flex-col justify-center gap-1 border-b border-line px-6">
        <h1 className="truncate text-title">{t.newSession}</h1>
        <span className="truncate text-meta text-fg-muted">{where}</span>
      </header>
      <section aria-label={t.newSession} className="min-h-0 grow" />
      <div className="flex flex-col gap-2 px-6 pt-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Menu.Root>
            <Menu.Trigger render={<Button />} aria-label={`${t.project}: ${project.name}`}>
              {project.name}
              <span aria-hidden="true">›</span>
            </Menu.Trigger>
            <Menu.Popup side="top" className="w-60">
              <Menu.RadioGroup value={project.path} onValueChange={(path: string) => onProjectChange(path)}>
                {projects.map((p) => (
                  <Menu.RadioItem key={p.path} value={p.path}>
                    <span className="min-w-0 grow truncate">{p.name}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Item onClick={openFolder}>
                <span className="grow">{t.openFolderItem}</span>
                <span className="text-meta text-fg-muted">⌘O</span>
              </Menu.Item>
              <Menu.Item onClick={() => setCloning(true)}>{t.cloneItem}</Menu.Item>
            </Menu.Popup>
          </Menu.Root>
          <GitBar path={project.path} />
        </div>
        <Composer />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={onProjectChange} />
    </main>
  );
}
