import type { ProjectInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { useState } from 'react';

import { GitBar } from '@/shared/components/git';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { CloneDialog } from './CloneDialog';
import { Composer } from './Composer';
import { messages } from './messages';

/**
 * Board NewSession: pick the project over the input, then type. No header and no status panel yet: they belong to
 * a session and appear with the first message, while the input stays where it is.
 */
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
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);

  return (
    <main aria-label={t.newSession} className="flex min-w-120 grow flex-col bg-canvas">
      <div className="min-h-0 grow" />
      <div className="mx-auto flex w-full max-w-202 flex-col gap-2 px-6 pt-3 pb-6">
        <div className="flex min-w-0 items-center gap-3">
          <Menu.Root>
            <Menu.Trigger render={<Button />} aria-label={`${t.project}: ${project.name}`} title={project.path}>
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
