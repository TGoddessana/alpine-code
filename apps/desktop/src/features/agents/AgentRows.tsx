import type { AgentInfo } from '@alpine/protocol';
import { Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';

import { agentMessages, alpineTools, shortModel, toolLabel, type AlpineTool } from '@/shared/components/agent';
import { ModelPicker } from '@/shared/components/composer';
import { connectionLabel, connectMessages } from '@/shared/components/connect';
import { skillTitle } from '@/shared/components/skills';
import { useFormat, useLocale, useMessages } from '@/shared/i18n';
import { useConnections, useSkills, useTools } from '@/shared/server';

import type { LibraryTab, SkillActions } from './library';
import { agentsMessages } from './messages';

const small =
  'inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-md border border-line bg-canvas-raised px-2.5 text-body hover:bg-canvas-sunken';

/** One row: what it is on the left, its content on the right. */
function Row({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line-subtle py-4">
      <div className="flex w-37 shrink-0 flex-col">
        <span className="text-body font-medium">{label}</span>
        <span className="text-meta text-fg-muted">{note}</span>
      </div>
      <div className="min-w-80 flex-1">{children}</div>
    </div>
  );
}

/** A tile for something the agent has: `flash` lights it up for a moment after it was added. */
function tile(lit: boolean) {
  return clsx(
    'flex items-center gap-1 rounded-lg border transition-colors',
    lit ? 'border-interactive bg-selected' : 'border-line bg-canvas-raised',
  );
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useMessages(agentsMessages);
  return (
    <button
      type="button"
      aria-label={t.remove(label)}
      onClick={onClick}
      className="flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg"
    >
      <X size={12} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

/**
 * Board 에이전트 화면, the rows: 모델, 지침, 기본 도구, 스킬 and the two
 * that are 준비 중. `onChange` saves the agent; `onAdd` and `onRemove` save a tool change and tell about it.
 */
export function AgentRows({
  agent,
  flash,
  onChange,
  onAdd,
  onRemove,
  onBrowse,
  onOpenSkill,
  skillActions,
}: {
  agent: AgentInfo;
  /** The tool that was just added. */
  flash: string | null;
  onChange: (agent: AgentInfo) => unknown;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
  onBrowse: (tab: LibraryTab) => void;
  onOpenSkill: (name: string) => void;
  skillActions: SkillActions;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const tools = useTools().data;
  // The memory's tools are in every agent: a locked tile, counted as on.
  const alpine = alpineTools(tools?.tools);
  const isOn = (tool: AlpineTool) => !tool.optional || agent.tools.includes(tool.name);
  const on = alpine.filter(isOn);

  return (
    <div className="flex flex-col">
      <ModelRow agent={agent} onChange={onChange} />
      <GuideRow agent={agent} onChange={onChange} />

      <Row label={t.builtinLabel} note={t.builtinNote(on.length, alpine.length)}>
        <div className="flex flex-wrap content-start gap-1.5">
          {alpine.map((x) => {
            const tool = x.name;
            const label = toolLabel(tool, a);
            if (!x.optional)
              return (
                <div key={tool} className={clsx(tile(false), 'px-2.5 py-1 text-body')}>
                  <span>{label}</span>
                  <span className="text-meta text-fg-muted">· {t.alwaysOn}</span>
                </div>
              );
            return isOn(x) ? (
              <div key={tool} className={clsx(tile(flash === tool), 'py-1 pr-1 pl-2.5 text-body')}>
                <span>{label}</span>
                <Remove label={label} onClick={() => onRemove([tool], label)} />
              </div>
            ) : (
              <button
                key={tool}
                type="button"
                onClick={() => onAdd([tool], label)}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1 text-body text-fg-faint hover:bg-hover"
              >
                <span className="line-through">{label}</span>
                <span className="text-meta text-interactive">{t.addBack}</span>
              </button>
            );
          })}
        </div>
      </Row>

      <SkillRow
        agent={agent}
        flash={flash}
        onOpen={onOpenSkill}
        onBrowse={() => onBrowse('skill')}
        actions={skillActions}
      />

      {(
        [
          [t.mcpLabel, t.mcpNote, t.mcpSoon],
          [t.subLabel, t.subNote, t.subSoon],
        ] as const
      ).map(([label, note, soon]) => (
        <Row key={label} label={label} note={note}>
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-fg-muted">
            <span className="shrink-0 rounded-full bg-canvas-sunken px-2 text-meta">{t.soon}</span>
            <span className="text-meta">{soon}</span>
          </div>
        </Row>
      ))}
    </div>
  );
}

/**
 * 스킬: every skill I have, since an agent has all of them unless it turns one off. One turned off stays, crossed
 * out, to add back; a press on a name opens it in the library.
 */
function SkillRow({
  agent,
  flash,
  onOpen,
  onBrowse,
  actions,
}: {
  agent: AgentInfo;
  flash: string | null;
  onOpen: (name: string) => void;
  onBrowse: () => void;
  actions: SkillActions;
}) {
  const t = useMessages(agentsMessages);
  const { locale } = useLocale();
  const skills = useSkills().data?.skills ?? [];
  const off = agent.skillsOff ?? [];
  return (
    <Row label={t.skillLabel} note={t.skillNote}>
      <div className="flex flex-wrap content-start gap-1.5">
        {skills.map((skill) => {
          const label = skillTitle(skill.name, locale);
          return off.includes(skill.name) ? (
            <button
              key={skill.name}
              type="button"
              onClick={() => actions.onToggle(skill.name, true, label)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1 text-body text-fg-faint hover:bg-hover"
            >
              <span className="line-through">{label}</span>
              <span className="text-meta text-interactive">{t.addBack}</span>
            </button>
          ) : (
            <div key={skill.name} className={clsx(tile(flash === skill.name), 'py-1 pr-1 pl-2.5 text-body')}>
              <button type="button" onClick={() => onOpen(skill.name)} className="cursor-pointer hover:underline">
                {label}
              </button>
              <Remove label={label} onClick={() => actions.onToggle(skill.name, false, label)} />
            </div>
          );
        })}
        <button
          type="button"
          onClick={onBrowse}
          className="flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line px-2.5 text-body text-fg-muted hover:bg-hover"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          {t.addSkill}
        </button>
      </div>
    </Row>
  );
}

function ModelRow({ agent, onChange }: { agent: AgentInfo; onChange: (agent: AgentInfo) => unknown }) {
  const t = useMessages(agentsMessages);
  const c = useMessages(connectMessages);
  const data = useConnections().data;
  const model = agent.model ?? data?.defaultModel ?? null;
  const connection = model ? data?.connections.find((x) => model.startsWith(`${x.name}/`)) : undefined;
  const via = connection ? connectionLabel(connection, data?.providers ?? [], c) : null;
  const name = agent.model ? shortModel(agent.model) : model ? t.defaultModel(shortModel(model)) : t.defaultModelPlain;
  return (
    <Row label={t.modelLabel} note={t.modelNote}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          <div className="text-body">{name}</div>
          {via && <div className="text-meta text-fg-muted">{via}</div>}
        </div>
        <ModelPicker
          value={agent.model}
          allowDefault
          label={t.changeModel}
          onChange={(next) => onChange({ ...agent, model: next })}
        />
      </div>
    </Row>
  );
}

const LONG_GUIDE = 2000;

/** 지침: text to read, or a bare box to write in (decision 13). Enter is a new line; leaving the box saves. */
function GuideRow({ agent, onChange }: { agent: AgentInfo; onChange: (agent: AgentInfo) => unknown }) {
  const t = useMessages(agentsMessages);
  const format = useFormat();
  const [draft, setDraft] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const text = draft ?? agent.instructions;
  // What I typed stays in the box until the save worked, so a failed save loses nothing.
  const stop = async () => {
    if (draft !== null && draft !== agent.instructions) {
      const saved = await onChange({ ...agent, instructions: draft });
      if (saved === false) return setNotSaved(true);
    }
    setNotSaved(false);
    setDraft(null);
  };
  return (
    <Row label={t.guideLabel} note={t.guideNote}>
      {draft === null ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 grow">
            {agent.instructions ? (
              <div className="text-body whitespace-pre-wrap">{agent.instructions}</div>
            ) : (
              <div className="text-body text-fg-faint">{t.guideEmpty}</div>
            )}
          </div>
          <button type="button" className={small} onClick={() => setDraft(agent.instructions)}>
            {t.guideEdit}
          </button>
        </div>
      ) : (
        <textarea
          autoFocus
          aria-label={t.guideField}
          rows={4}
          value={draft}
          placeholder={t.guidePlaceholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setNotSaved(false);
          }}
          onBlur={() => void stop()}
          className="block w-full resize-y rounded-sm bg-transparent p-0 text-body outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-interactive"
        />
      )}
      {(draft !== null || agent.instructions) && (
        <div className="mt-1.5 flex flex-wrap gap-x-2 text-meta text-fg-faint">
          <span>{t.guideCount(format.number(text.length))}</span>
          {text.length > LONG_GUIDE && <span className="text-attention">{t.guideLong}</span>}
          {notSaved && (
            <span role="alert" className="text-danger">
              {t.guideNotSaved}
            </span>
          )}
          {draft !== null && <span className="ml-auto">{t.guideBlur}</span>}
        </div>
      )}
    </Row>
  );
}
