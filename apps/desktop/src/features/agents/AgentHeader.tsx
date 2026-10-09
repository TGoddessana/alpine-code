import type { AgentInfo } from '@alpine/protocol';
import { Button, Dialog, Menu } from '@alpine/ui/primitives';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { Ellipsis, Pencil } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { agentMessages, agentName } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';
import { useDeleteAgent, useSaveAgent, useSessions } from '@/shared/server';

import { CharacterPicker } from './CharacterPicker';
import { agentsMessages } from './messages';

/**
 * Board 에이전트 화면, the header: the character, the name and description (bare text, edited in place from one
 * pencil), whether the last change is saved, the agent's menu and 이 에이전트로 새 세션.
 */
export function AgentHeader({
  agent,
  saved,
  onSave,
  onSelect,
}: {
  agent: AgentInfo;
  /** Whether something was just saved. */
  saved: boolean;
  onSave: (agent: AgentInfo) => void;
  onSelect: (id: string) => void;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const start = () => {
    setName(agent.name);
    setDescription(agent.description);
    setEditing(true);
  };
  const commit = () => {
    const next = { ...agent, name: name.trim() || agent.name, description: description.trim() };
    setEditing(false);
    if (next.name !== agent.name || next.description !== agent.description) onSave(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setEditing(false);
    }
  };
  // Bare inputs: no box, no border, the type of the text they replace; only the focus ring shows.
  const bare =
    'block w-full min-w-0 rounded-sm bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-interactive';

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <CharacterPicker agent={agent} onChange={(character) => onSave({ ...agent, ...character })} />
      <div className="min-w-60 flex-1">
        {editing ? (
          <>
            <input
              autoFocus
              aria-label={t.nameLabel}
              value={name}
              placeholder={agentName(agent, a)}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={onKeyDown}
              className={clsx(bare, 'text-display font-medium')}
            />
            <input
              aria-label={t.descriptionLabel}
              value={description}
              placeholder={t.descriptionPlaceholder}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={onKeyDown}
              className={clsx(bare, 'mt-0.5 text-body text-fg-muted placeholder:text-fg-faint')}
            />
            <p className="mt-1.5 text-meta text-fg-faint">{t.editHint}</p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <h1 className="text-display font-medium">{agentName(agent, a)}</h1>
              {agent.description && <p className="mt-0.5 text-body text-fg-muted">{agent.description}</p>}
            </div>
            <button
              type="button"
              aria-label={t.editNameAndDescription}
              onClick={start}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span role="status" className={clsx('text-meta', saved ? 'text-interactive' : 'text-fg-faint')}>
          {saved ? t.saved : t.autoSaves}
        </span>
        <AgentMenu agent={agent} onSelect={onSelect} />
        <Link
          to="/"
          search={{ agent: agent.id }}
          className="inline-flex min-h-8 items-center rounded-lg border border-interactive bg-interactive px-3 text-body font-medium whitespace-nowrap text-on-fill hover:bg-interactive-hover"
        >
          {t.startSession}
        </Link>
      </div>
    </div>
  );
}

/** The agent's ⋮ menu: copy it, or delete it (the default one stays). */
function AgentMenu({ agent, onSelect }: { agent: AgentInfo; onSelect: (id: string) => void }) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const save = useSaveAgent();
  const remove = useDeleteAgent();
  const [asking, setAsking] = useState(false);
  const name = agentName(agent, a);

  const duplicate = () =>
    save.mutate({ ...agent, id: '', name: t.copyName(name) }, { onSuccess: (copy) => onSelect(copy.id) });
  const confirm = () =>
    remove.mutate(agent.id, {
      onSuccess: () => {
        setAsking(false);
        onSelect('');
      },
    });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={t.agentMenu}
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-canvas-raised text-fg-muted hover:bg-canvas-sunken data-popup-open:bg-canvas-sunken"
        >
          <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Popup align="end">
          <Menu.Item onClick={duplicate}>{t.duplicate}</Menu.Item>
          <Menu.Item disabled={agent.id === 'default'} onClick={() => setAsking(true)}>
            {t.delete}
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <Dialog.Root open={asking} onOpenChange={setAsking}>
        <Dialog.Popup size="sm" role="alertdialog">
          <div className="flex flex-col gap-2">
            <Dialog.Title>{t.deleteTitle(name)}</Dialog.Title>
            <Dialog.Description>{t.deleteBody}</Dialog.Description>
          </div>
          {remove.error && (
            <p role="alert" className="text-meta text-danger">
              {remove.error.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
            <Button variant="danger" disabled={remove.isPending} onClick={confirm}>
              {t.confirmDelete}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

/** Board 에이전트 화면, ● 지금 일하는 중: the sessions that use this agent and are busy now. Nothing when none is. */
export function WorkingLine({ agentId }: { agentId: string }) {
  const t = useMessages(agentsMessages);
  const sessions = (useSessions().data ?? []).filter(
    (s) => s.agent === agentId && (s.status === 'running' || s.status === 'waiting'),
  );
  const first = sessions[0];
  if (!first) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-canvas-raised px-3.5 py-2.5 text-body"
    >
      <span aria-hidden="true" className="text-fg-faint">
        ●
      </span>
      <span>{t.working}</span>
      <span>·</span>
      <Link
        to="/session/$sessionId"
        params={{ sessionId: first.id }}
        className="text-interactive hover:text-interactive-hover hover:underline"
      >
        {first.title || t.untitledSession}
      </Link>
      {sessions.length > 1 && <span>{t.workingMore(sessions.length - 1)}</span>}
      <span className="min-w-50 flex-1 text-right text-meta text-fg-muted">{t.workingNote}</span>
    </div>
  );
}
