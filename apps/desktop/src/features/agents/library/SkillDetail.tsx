import type { AgentInfo } from '@alpine/protocol';
import { Button, Dialog } from '@alpine/ui/primitives';
import { useState } from 'react';

import { agentMessages, agentName, Character } from '@/shared/components/agent';
import { Markdown } from '@/shared/components/markdown';
import { skillApp, skillAppName, skillDoes, skillError, skillMessages, skillTitle } from '@/shared/components/skills';
import { useFormat, useLocale, useMessages } from '@/shared/i18n';
import { revealInFinder } from '@/shared/platform';
import { useAddSkill, useRemoveSkill, useSaveSkill, useSkill } from '@/shared/server';

import { librarySkillMessages } from './skillMessages';
import type { LibraryView, SkillActions } from './types';

/** The text after the front matter, to read; the whole file is what is edited. */
function bodyOf(text: string): string {
  const match = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? text.slice(match[0].length) : text).trim();
}

/**
 * A skill opened in the library: what it does, whether the agent being edited uses it (and the others), what it
 * brings, and its SKILL.md. Alpine's own skills can be edited, fetched again and deleted; another app's only read.
 */
export function SkillDetail({
  agent,
  agents,
  name,
  onViewChange,
  actions,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  name: string;
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const a = useMessages(agentMessages);
  const { locale } = useLocale();
  const format = useFormat();
  const got = useSkill(name);
  const save = useSaveSkill();
  const remove = useRemoveSkill();
  const again = useAddSkill();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const back = () => onViewChange({ kind: 'list', tab: 'skill' });
  if (!got.data) return null;
  const { skill, text, files } = got.data;
  const title = skillTitle(skill.name, locale);
  const on = !(agent.skillsOff ?? []).includes(skill.name);
  const off = agents.filter((x) => x.id !== agent.id && (x.skillsOff ?? []).includes(skill.name));
  const app = skillApp(skill, s);
  const otherApp = skillAppName(skill, s);
  const owned = skill.origin === 'alpine';
  const from = owned ? (skill.source ? t.fromSource(skill.source) : t.madeHere) : (app ?? t.fromAlpine);

  const commit = async () => {
    if (draft === null) return;
    setError(null);
    try {
      await save.mutateAsync({ name: skill.name, text: draft });
      await got.refetch();
      setDraft(null);
      setSaved(true);
    } catch (reason) {
      setError(skillError(reason, s));
    }
  };
  const fetchAgain = async () => {
    if (!skill.source) return;
    setError(null);
    try {
      await again.mutateAsync({ source: skill.source, names: [skill.name] });
      await got.refetch();
    } catch (reason) {
      setError(skillError(reason, s));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-4 pb-6">
      <button
        type="button"
        onClick={back}
        className="-ml-2 cursor-pointer self-start rounded-md px-2 py-1 text-body text-fg-muted hover:bg-canvas-sunken"
      >
        {t.back}
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-meta break-words text-fg-faint">{t.kicker(from)}</span>
        <h2 className="text-display break-words">{title}</h2>
        {title !== skill.name && <span className="font-mono text-meta text-fg-faint">/{skill.name}</span>}
        <p className="text-body text-fg-muted">{skillDoes(skill, locale, true)}</p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas-raised p-3">
        <Character look={agent.look} color={agent.color} size={32} />
        <div className="flex min-w-0 grow flex-col">
          <span className="text-body">{on ? t.inAgent(agentName(agent, a)) : t.offInAgent(agentName(agent, a))}</span>
          <span className="text-meta text-fg-faint">
            {off.length > 0 ? t.someAgentsOff(off.map((x) => agentName(x, a)).join(', ')) : t.everyAgent}
          </span>
        </div>
        {on ? (
          <Button onClick={() => actions.onToggle(skill.name, false, title)}>{t.turnOff}</Button>
        ) : (
          <Button variant="primary" onClick={() => actions.onToggle(skill.name, true, title)}>
            {t.turnOn}
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-1.5 text-meta text-fg-muted">
        <li>{t.howUsed}</li>
        {skill.hasScripts && <li>{t.scripts}</li>}
        {skill.origin === 'project' && <li>{t.projectSkill}</li>}
        {skill.notes.length > 0 && <li>{t.notes(skill.notes.join(', '))}</li>}
      </ul>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex min-h-10 items-center gap-2 border-b border-line bg-canvas-sunken py-1.5 pr-2 pl-3">
          <span className="grow text-meta text-fg-muted">{t.content} · SKILL.md</span>
          {owned &&
            (draft === null ? (
              <Button onClick={() => (setDraft(text), setSaved(false))}>{t.edit}</Button>
            ) : (
              <>
                <Button className="border-transparent bg-transparent" onClick={() => setDraft(null)}>
                  {t.cancel}
                </Button>
                <Button variant="primary" disabled={save.isPending} onClick={() => void commit()}>
                  {save.isPending ? t.saving : t.save}
                </Button>
              </>
            ))}
        </div>
        {saved && (
          <div
            role="status"
            className="border-b border-line-subtle bg-canvas-raised px-3 py-1.5 text-meta text-interactive"
          >
            {t.saved}
          </div>
        )}
        {draft === null ? (
          <div className="max-h-120 overflow-y-auto bg-canvas-raised px-4 py-3">
            <Markdown text={bodyOf(text)} streaming={false} />
          </div>
        ) : (
          <textarea
            aria-label={t.content}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={18}
            className="block w-full resize-y bg-canvas-raised px-3 py-2 font-mono text-meta outline-none"
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <details className="text-meta text-fg-muted">
          <summary className="cursor-pointer">{t.files(format.number(files.length))}</summary>
          <ul className="mt-1.5 flex flex-col gap-0.5 pl-3 font-mono">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={() => void revealInFinder(skill.folder)}>{t.showFolder}</Button>
        {owned && skill.source && (
          <Button disabled={again.isPending} onClick={() => void fetchAgain()}>
            {again.isPending ? t.updating : t.update}
          </Button>
        )}
        {owned ? (
          <Button className="ml-auto border-transparent bg-transparent text-danger" onClick={() => setRemoving(true)}>
            {t.remove}
          </Button>
        ) : (
          otherApp && <span className="text-meta text-fg-faint">{t.otherApp(otherApp)}</span>
        )}
      </div>
      <Dialog.Root open={removing} onOpenChange={setRemoving}>
        <Dialog.Popup size="sm">
          <Dialog.Title>{t.removeTitle(title)}</Dialog.Title>
          <Dialog.Description>{t.removeBody}</Dialog.Description>
          <div className="flex justify-end gap-2 pt-2">
            <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(skill.name, { onSuccess: () => (setRemoving(false), back()) })}
            >
              {t.removeConfirm}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </div>
  );
}
