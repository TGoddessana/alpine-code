import type { AgentInfo } from '@alpine/protocol';
import { Button, Dialog, Input, Menu } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState } from 'react';

import { Character, agentMessages, agentName, toolLabel } from '@/shared/components/agent';
import { ModelPicker } from '@/shared/components/composer';
import { useMessages } from '@/shared/i18n';
import { useAgents, useSaveAgent } from '@/shared/server';

import { agentsMessages } from './messages';
import { DEFAULT_START, STARTS, startText, type StartId } from './starts';

/**
 * Board 새 에이전트: four starting points, the name and the model, and a way to copy an agent that already exists.
 * `onCreated` gets the id of the agent that was made. Characters are made unique by the server.
 */
export function NewAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Popup size="md">
        <Form onClose={onClose} onCreated={onCreated} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function Form({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const agents = useAgents().data?.agents ?? [];
  const save = useSaveAgent();
  const [pick, setPick] = useState<StartId>(DEFAULT_START);
  const [name, setName] = useState(() => startText(DEFAULT_START, t).name);
  const [model, setModel] = useState<string | null>(null);
  const start = STARTS.find((s) => s.id === pick)!;
  const text = startText(pick, t);

  const choose = (id: StartId) => {
    setPick(id);
    setName(startText(id, t).name);
  };
  const create = () =>
    save.mutate(
      {
        id: '',
        name: name.trim() || text.name,
        description: text.description,
        model,
        instructions: text.instructions,
        tools: [...start.tools],
        look: start.look as AgentInfo['look'],
        color: start.color,
      },
      {
        onSuccess: (saved) => {
          onClose();
          onCreated(saved.id);
        },
      },
    );
  const copy = (agent: AgentInfo) =>
    save.mutate(
      { ...agent, id: '', name: t.copyName(agentName(agent, a)) },
      {
        onSuccess: (saved) => {
          onClose();
          onCreated(saved.id);
        },
      },
    );

  return (
    <>
      <div className="flex flex-col gap-1">
        <Dialog.Title className="text-display">{t.newTitle}</Dialog.Title>
        <Dialog.Description>{t.newLead}</Dialog.Description>
      </div>

      <div
        role="radiogroup"
        aria-label={t.starts}
        onKeyDown={(event) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
          if (!step || event.nativeEvent.isComposing) return;
          event.preventDefault();
          const at = STARTS.findIndex((s) => s.id === pick);
          const next = STARTS[(at + step + STARTS.length) % STARTS.length]!;
          choose(next.id);
          event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[STARTS.indexOf(next)]?.focus();
        }}
        className="grid grid-cols-4 gap-2.5"
      >
        {STARTS.map((s) => {
          const words = startText(s.id, t);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === pick}
              tabIndex={s.id === pick ? 0 : -1}
              onClick={() => choose(s.id)}
              className={clsx(
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 px-2.5 pt-4 pb-3.5 text-center',
                s.id === pick ? 'border-interactive bg-selected' : 'border-line bg-canvas-raised hover:bg-hover',
              )}
            >
              <Character look={s.look} color={s.color} size={72} label="" />
              <span className="text-body font-medium">{words.title}</span>
              <span className="text-meta text-fg-muted">{words.intro}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-canvas-sunken p-3.5">
        <span className="text-meta text-fg-muted">{t.startsWith}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-meta text-fg-faint">{t.builtinLabel}</span>
          {start.tools.map((tool) => (
            <span key={tool} className="rounded-md border border-line bg-canvas-raised px-2 text-meta">
              {toolLabel(tool, a)}
            </span>
          ))}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-meta text-fg-faint">{t.guideLabel}</span>
          <span className="text-body whitespace-pre-wrap">{text.instructions || t.emptyGuide}</span>
        </div>
      </div>

      <div className="flex gap-4">
        <label className="flex min-w-0 grow flex-col gap-1.5">
          <span className="text-meta text-fg-muted">{t.nameField}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <span className="text-meta text-fg-muted">{t.modelField}</span>
          <div>
            <ModelPicker value={model} allowDefault onChange={setModel} />
          </div>
        </div>
      </div>

      {save.error && (
        <p role="alert" className="text-meta text-danger">
          {save.error.message}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Menu.Root>
          <Menu.Trigger className="mr-auto min-h-7 cursor-pointer rounded-sm px-1 text-meta text-interactive hover:text-interactive-hover hover:underline">
            {t.cloneExisting}
          </Menu.Trigger>
          <Menu.Popup side="top">
            {agents.map((agent) => (
              <Menu.Item key={agent.id} onClick={() => copy(agent)}>
                <Character look={agent.look} color={agent.color} size={22} label="" />
                {agentName(agent, a)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Root>
        <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
        <Button variant="primary" disabled={save.isPending} onClick={create}>
          {t.create}
        </Button>
      </div>
    </>
  );
}
