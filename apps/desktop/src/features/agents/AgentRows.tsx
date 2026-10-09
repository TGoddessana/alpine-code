import type { AgentInfo, ToolsListResult } from '@alpine/protocol';
import { Plus, Pencil, X } from 'lucide-react';
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';

import { BUILTIN_TOOLS, agentMessages, isBuiltin, toolLabel } from '@/shared/components/agent';
import { ModelPicker } from '@/shared/components/composer';
import { connectionLabel, connectMessages } from '@/shared/components/connect';
import { useFormat, useMessages } from '@/shared/i18n';
import { useConnections, useTools } from '@/shared/server';

import type { LibraryTab } from './library';
import { agentsMessages } from './messages';

const dashed =
  'inline-flex min-h-13 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3.5 py-2 text-body hover:bg-hover';
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
 * Board 에이전트 화면, the rows (docs/agents.md decision 6): 모델, 지침, 기본 도구, 사용자 정의 도구 and the three
 * that are 준비 중. `onChange` saves the agent; `onAdd` and `onRemove` save a tool change and tell about it.
 */
export function AgentRows({
  agent,
  flash,
  onChange,
  onAdd,
  onRemove,
  onOpenTool,
  onBrowse,
  onNewTool,
}: {
  agent: AgentInfo;
  /** The tool that was just added. */
  flash: string | null;
  onChange: (agent: AgentInfo) => void;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
  onOpenTool: (file: string, tool: string) => void;
  onBrowse: (tab: LibraryTab) => void;
  onNewTool: () => void;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const tools = useTools().data;
  const on = BUILTIN_TOOLS.filter((tool) => agent.tools.includes(tool));
  const custom = agent.tools.filter((tool) => !isBuiltin(tool));

  return (
    <div className="flex flex-col">
      <ModelRow agent={agent} onChange={onChange} />
      <GuideRow agent={agent} onChange={onChange} />

      <Row label={t.builtinLabel} note={t.builtinNote(on.length, BUILTIN_TOOLS.length)}>
        <div className="flex flex-wrap content-start gap-1.5">
          {BUILTIN_TOOLS.map((tool) => {
            const label = toolLabel(tool, a);
            return agent.tools.includes(tool) ? (
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

      <Row label={t.customLabel} note={t.customNote}>
        <div className="flex flex-wrap gap-2">
          {custom.map((tool) => (
            <CustomTile
              key={tool}
              tool={tool}
              tools={tools}
              lit={flash === tool}
              onOpen={onOpenTool}
              onRemove={() => onRemove([tool], tool)}
            />
          ))}
          <button type="button" onClick={() => onBrowse('tool')} className={clsx(dashed, 'text-fg-muted')}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {t.addFromLibrary}
          </button>
          <button type="button" onClick={onNewTool} className={clsx(dashed, 'text-interactive')}>
            <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
            {t.createTool}
          </button>
        </div>
      </Row>

      {(
        [
          [t.skillLabel, t.skillNote, t.skillSoon],
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

function CustomTile({
  tool,
  tools,
  lit,
  onOpen,
  onRemove,
}: {
  tool: string;
  tools: ToolsListResult | undefined;
  lit: boolean;
  onOpen: (file: string, tool: string) => void;
  onRemove: () => void;
}) {
  const t = useMessages(agentsMessages);
  const file = tools?.files.find((f) => f.tools.some((x) => x.name === tool));
  const does = file?.tools.find((x) => x.name === tool)?.description.split('\n')[0] ?? '';
  const body = (
    <>
      <span className="text-body font-medium">{tool}</span>
      {does && <span className="text-meta text-fg-muted">{does}</span>}
      {file && <span className="mt-0.5 text-meta text-interactive">{t.openCode}</span>}
    </>
  );
  return (
    <div className={clsx(tile(lit), 'min-h-13 items-start py-2 pr-1.5 pl-3')}>
      {file ? (
        <button
          type="button"
          onClick={() => onOpen(file.name, tool)}
          className="flex min-w-0 cursor-pointer flex-col text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-col">{body}</div>
      )}
      <Remove label={tool} onClick={onRemove} />
    </div>
  );
}

function ModelRow({ agent, onChange }: { agent: AgentInfo; onChange: (agent: AgentInfo) => void }) {
  const t = useMessages(agentsMessages);
  const c = useMessages(connectMessages);
  const data = useConnections().data;
  const short = (model: string) => model.slice(model.indexOf('/') + 1);
  const model = agent.model ?? data?.defaultModel ?? null;
  const connection = model ? data?.connections.find((x) => model.startsWith(`${x.name}/`)) : undefined;
  const via = connection ? connectionLabel(connection, data?.providers ?? [], c) : null;
  const name = agent.model ? short(agent.model) : model ? t.defaultModel(short(model)) : t.defaultModelPlain;
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
function GuideRow({ agent, onChange }: { agent: AgentInfo; onChange: (agent: AgentInfo) => void }) {
  const t = useMessages(agentsMessages);
  const format = useFormat();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? agent.instructions;
  const stop = () => {
    if (draft !== null && draft !== agent.instructions) onChange({ ...agent, instructions: draft });
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
          onChange={(event) => setDraft(event.target.value)}
          onBlur={stop}
          className="block w-full resize-y rounded-sm bg-transparent p-0 text-body outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-interactive"
        />
      )}
      {(draft !== null || agent.instructions) && (
        <div className="mt-1.5 flex flex-wrap gap-x-2 text-meta text-fg-faint">
          <span>{t.guideCount(format.number(text.length))}</span>
          {text.length > LONG_GUIDE && <span className="text-attention">{t.guideLong}</span>}
          {draft !== null && <span className="ml-auto">{t.guideBlur}</span>}
        </div>
      )}
    </Row>
  );
}
