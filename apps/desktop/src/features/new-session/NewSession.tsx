import type { ProjectInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { useRef, useState } from 'react';

import { Composer, ModelPicker, ProfileChip } from '@/shared/components/composer';
import { GitBar } from '@/shared/components/git';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';
import { useConnections, useNewSession, useSendMessage } from '@/shared/server';

import { CloneDialog } from './CloneDialog';
import { ExampleCards } from './ExampleCards';
import { messages } from './messages';

/**
 * Board NewSession: pick the project over the input, then type. No header and no work result panel yet: they belong to
 * a session and appear with the first message, while the input stays where it is.
 *
 * Sending starts the session in the project's folder with the default model, sends the message, and calls
 * `onStarted` with the new session's id so the app can show it.
 */
export function NewSession({
  projects,
  project,
  onProjectChange,
  onStarted,
}: {
  projects: ProjectInfo[];
  project: ProjectInfo;
  onProjectChange: (path: string) => void;
  onStarted: (sessionId: string) => void;
}) {
  const t = useMessages(messages);
  const defaultModel = useConnections().data?.defaultModel;
  const newSession = useNewSession();
  const sendMessage = useSendMessage();
  // A session made for a message that then failed to send is used again on retry, not made twice.
  const made = useRef<{ path: string; id: string } | null>(null);
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  // A profile picked in the chip, for this project only; otherwise the one the project and model match.
  const [profile, setProfile] = useState<{ path: string; id: string } | null>(null);
  const [prefill, setPrefill] = useState({ text: '', key: 0 });
  const chosen = profile?.path === project.path ? profile.id : null;

  const start = async (text: string) => {
    if (made.current?.path !== project.path) {
      const info = await newSession.mutateAsync({
        cwd: project.path,
        ...(defaultModel ? { model: defaultModel } : {}),
        ...(chosen ? { profile: chosen } : {}),
      });
      made.current = { path: project.path, id: info.id };
    }
    const { id } = made.current;
    await sendMessage.mutateAsync({ sessionId: id, text });
    made.current = null;
    onStarted(id);
  };

  return (
    <main aria-label={t.newSession} className="flex min-w-120 grow flex-col bg-canvas">
      <div className="min-h-0 grow" />
      <div className="mx-auto flex w-full max-w-160 flex-col items-center gap-6 px-6 pb-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-display font-semibold">{t.heading}</h1>
          <p className="text-body text-fg-muted">{t.lead(project.name)}</p>
        </div>
        <ExampleCards onPick={(text) => setPrefill((last) => ({ text, key: last.key + 1 }))} />
      </div>
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
        <Composer
          onSend={start}
          prefill={prefill}
          bar={
            <>
              <ProfileChip
                cwd={project.path}
                model={defaultModel ?? null}
                chosen={chosen}
                onChoose={(id) => setProfile(id ? { path: project.path, id } : null)}
              />
              <ModelPicker />
            </>
          }
        />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={onProjectChange} />
    </main>
  );
}
